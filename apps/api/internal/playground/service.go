package playground

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/terraforge/terraforge/apps/api/internal/namespaces"
)

var (
	ErrNotFound   = errors.New("playground template not found")
	ErrValidation = errors.New("validation failed")
	ErrForbidden  = errors.New("forbidden")
)

type Template struct {
	ID                uuid.UUID         `json:"id"`
	OwnerUserID       uuid.UUID         `json:"owner_user_id"`
	Name              string            `json:"name"`
	Description       string            `json:"description"`
	Files             map[string]string `json:"files"`
	SourceNamespaceID *uuid.UUID        `json:"source_namespace_id,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

type CreateInput struct {
	Name              string
	Description       string
	Files             map[string]string
	SourceNamespaceID *uuid.UUID
}

type UpdateInput struct {
	Name        *string
	Description *string
	Files       map[string]string
}

type Service struct {
	pool *pgxpool.Pool
	ns   *namespaces.Service
}

func NewService(pool *pgxpool.Pool, ns *namespaces.Service) *Service {
	return &Service{pool: pool, ns: ns}
}

func (s *Service) List(ctx context.Context, ownerID uuid.UUID) ([]Template, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, owner_user_id, name, description, files, source_namespace_id, created_at, updated_at
		FROM playground_templates
		WHERE owner_user_id = $1
		ORDER BY updated_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Template
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) Get(ctx context.Context, id, ownerID uuid.UUID) (Template, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id, owner_user_id, name, description, files, source_namespace_id, created_at, updated_at
		FROM playground_templates
		WHERE id = $1
	`, id)
	t, err := scanTemplate(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrNotFound
	}
	if err != nil {
		return Template{}, err
	}
	if t.OwnerUserID != ownerID {
		return Template{}, ErrForbidden
	}
	return t, nil
}

func (s *Service) Create(ctx context.Context, ownerID uuid.UUID, in CreateInput) (Template, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Template{}, fmt.Errorf("%w: name required", ErrValidation)
	}
	if len(in.Files) == 0 {
		return Template{}, fmt.Errorf("%w: files required", ErrValidation)
	}
	filesJSON, err := json.Marshal(in.Files)
	if err != nil {
		return Template{}, err
	}
	desc := strings.TrimSpace(in.Description)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO playground_templates (owner_user_id, name, description, files, source_namespace_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, owner_user_id, name, description, files, source_namespace_id, created_at, updated_at
	`, ownerID, name, desc, filesJSON, in.SourceNamespaceID)
	return scanTemplate(row)
}

func (s *Service) Update(ctx context.Context, id, ownerID uuid.UUID, in UpdateInput) (Template, error) {
	t, err := s.Get(ctx, id, ownerID)
	if err != nil {
		return Template{}, err
	}
	name := t.Name
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
		if name == "" {
			return Template{}, fmt.Errorf("%w: name required", ErrValidation)
		}
	}
	desc := t.Description
	if in.Description != nil {
		desc = strings.TrimSpace(*in.Description)
	}
	files := t.Files
	if in.Files != nil {
		if len(in.Files) == 0 {
			return Template{}, fmt.Errorf("%w: files required", ErrValidation)
		}
		files = in.Files
	}
	filesJSON, err := json.Marshal(files)
	if err != nil {
		return Template{}, err
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE playground_templates
		SET name = $3, description = $4, files = $5, updated_at = now()
		WHERE id = $1 AND owner_user_id = $2
		RETURNING id, owner_user_id, name, description, files, source_namespace_id, created_at, updated_at
	`, id, ownerID, name, desc, filesJSON)
	return scanTemplate(row)
}

func (s *Service) Delete(ctx context.Context, id, ownerID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM playground_templates WHERE id = $1 AND owner_user_id = $2
	`, id, ownerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Distinguish not found vs forbidden
		var exists bool
		_ = s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playground_templates WHERE id = $1)`, id).Scan(&exists)
		if exists {
			return ErrForbidden
		}
		return ErrNotFound
	}
	return nil
}

// Launch creates a playground namespace, imports template files, and returns the namespace.
func (s *Service) Launch(ctx context.Context, ownerID uuid.UUID, templateID uuid.UUID, name, slug string) (namespaces.Namespace, Template, error) {
	t, err := s.Get(ctx, templateID, ownerID)
	if err != nil {
		return namespaces.Namespace{}, Template{}, err
	}
	nsName := strings.TrimSpace(name)
	if nsName == "" {
		nsName = t.Name
	}
	ns, err := s.ns.Create(ctx, namespaces.CreateInput{
		Name:         nsName,
		Slug:         slug,
		IsPlayground: true,
	})
	if err != nil {
		return namespaces.Namespace{}, Template{}, err
	}
	if _, err := s.ns.ImportFiles(ns.ID.String(), t.Files, "Launch playground template: "+t.Name); err != nil {
		_ = s.ns.Delete(ctx, ns.ID)
		return namespaces.Namespace{}, Template{}, err
	}
	return ns, t, nil
}

// SnapshotFromNamespace saves current namespace files as a playground template.
func (s *Service) SnapshotFromNamespace(ctx context.Context, ownerID, nsID uuid.UUID, name, description string) (Template, error) {
	ns, err := s.ns.Get(ctx, nsID)
	if err != nil {
		return Template{}, err
	}
	files, err := s.ns.ExportFilesMap(ns.ID.String())
	if err != nil {
		return Template{}, err
	}
	if len(files) == 0 {
		return Template{}, fmt.Errorf("%w: namespace has no config files to save", ErrValidation)
	}
	tplName := strings.TrimSpace(name)
	if tplName == "" {
		tplName = ns.Name
	}
	src := ns.ID
	return s.Create(ctx, ownerID, CreateInput{
		Name:              tplName,
		Description:       description,
		Files:             files,
		SourceNamespaceID: &src,
	})
}

type scannable interface {
	Scan(dest ...any) error
}

func scanTemplate(row scannable) (Template, error) {
	var t Template
	var filesRaw []byte
	if err := row.Scan(
		&t.ID, &t.OwnerUserID, &t.Name, &t.Description, &filesRaw,
		&t.SourceNamespaceID, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return Template{}, err
	}
	t.Files = map[string]string{}
	if len(filesRaw) > 0 {
		if err := json.Unmarshal(filesRaw, &t.Files); err != nil {
			return Template{}, err
		}
	}
	return t, nil
}
