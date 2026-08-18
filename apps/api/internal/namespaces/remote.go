package namespaces

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type ConnectRemoteInput struct {
	RemoteURL string
	PAT       string
	Push      bool
}

func (s *Service) ConnectRemote(ctx context.Context, id uuid.UUID, in ConnectRemoteInput) (Namespace, error) {
	ns, err := s.Get(ctx, id)
	if err != nil {
		return Namespace{}, err
	}
	remoteURL := strings.TrimSpace(in.RemoteURL)
	if remoteURL == "" {
		return Namespace{}, fmt.Errorf("%w: remote_url is required", ErrValidation)
	}
	repo := s.RepoPath(id)

	// Remove existing origin if present, then add.
	_ = runGit(repo, "remote", "remove", "origin")
	if err := runGit(repo, "remote", "add", "origin", remoteURL); err != nil {
		return Namespace{}, err
	}

	authURL := withPAT(remoteURL, in.PAT)
	if in.Push {
		if err := runGit(repo, "push", "-u", authURL, "HEAD:"+ns.DefaultBranch); err != nil {
			// fall back to named remote if URL push fails oddly
			if err2 := pushWithAskpass(repo, in.PAT, ns.DefaultBranch); err2 != nil {
				return Namespace{}, fmt.Errorf("push: %v / %v", err, err2)
			}
		}
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE namespaces SET has_remote = true, remote_url = $2 WHERE id = $1
	`, id, remoteURL)
	if err != nil {
		return Namespace{}, err
	}
	return s.Get(ctx, id)
}

type CreateFromRemoteInput struct {
	Name             string
	Slug             string
	RemoteURL        string
	PAT              string
	TerraformVersion string
}

func (s *Service) CreateFromRemote(ctx context.Context, in CreateFromRemoteInput) (Namespace, error) {
	name := strings.TrimSpace(in.Name)
	if err := validateName(name); err != nil {
		return Namespace{}, err
	}
	slug := strings.TrimSpace(in.Slug)
	if slug == "" {
		slug = slugify(name)
	} else {
		slug = slugify(slug)
	}
	if err := validateSlug(slug); err != nil {
		return Namespace{}, err
	}
	tfVersion := strings.TrimSpace(in.TerraformVersion)
	if tfVersion == "" {
		tfVersion = "1.9.0"
	}
	remoteURL := strings.TrimSpace(in.RemoteURL)
	if remoteURL == "" {
		return Namespace{}, fmt.Errorf("%w: remote_url is required", ErrValidation)
	}

	const defaultBranch = "main"
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Namespace{}, err
	}
	defer tx.Rollback(ctx)

	var ns Namespace
	err = tx.QueryRow(ctx, `
		INSERT INTO namespaces (name, slug, terraform_version, default_branch, has_remote, remote_url)
		VALUES ($1, $2, $3, $4, true, $5)
		RETURNING id, name, slug, terraform_version, has_remote, remote_url, default_branch,
		          require_approval, drift_interval_minutes, has_drift, drift_detected_at, created_at
	`, name, slug, tfVersion, defaultBranch, remoteURL).Scan(
		&ns.ID, &ns.Name, &ns.Slug, &ns.TerraformVersion, &ns.HasRemote,
		&ns.RemoteURL, &ns.DefaultBranch, &ns.RequireApproval, &ns.DriftIntervalMinutes,
		&ns.HasDrift, &ns.DriftDetectedAt, &ns.CreatedAt,
	)
	if err != nil {
		return Namespace{}, err
	}
	ns.Status = StatusNeverRun

	dir := s.repoPath(ns.ID.String())
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return Namespace{}, err
	}
	cloneURL := withPAT(remoteURL, in.PAT)
	if err := runGit(".", "clone", cloneURL, dir); err != nil {
		_ = os.RemoveAll(dir)
		return Namespace{}, fmt.Errorf("clone: %w", err)
	}
	_ = runGit(dir, "config", "user.email", "terraforge@local")
	_ = runGit(dir, "config", "user.name", "Terraforge")
	// Ensure origin points at clean URL without embedded token.
	_ = runGit(dir, "remote", "set-url", "origin", remoteURL)

	if err := tx.Commit(ctx); err != nil {
		_ = os.RemoveAll(dir)
		return Namespace{}, err
	}
	return ns, nil
}

func (s *Service) Push(ctx context.Context, id uuid.UUID, pat string) error {
	ns, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if !ns.HasRemote || ns.RemoteURL == nil {
		return fmt.Errorf("%w: namespace has no remote", ErrValidation)
	}
	repo := s.RepoPath(id)
	authURL := withPAT(*ns.RemoteURL, pat)
	if err := runGit(repo, "push", authURL, "HEAD:"+ns.DefaultBranch); err != nil {
		return pushWithAskpass(repo, pat, ns.DefaultBranch)
	}
	return nil
}

func (s *Service) Pull(ctx context.Context, id uuid.UUID, pat string) error {
	ns, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if !ns.HasRemote || ns.RemoteURL == nil {
		return fmt.Errorf("%w: namespace has no remote", ErrValidation)
	}
	repo := s.RepoPath(id)
	authURL := withPAT(*ns.RemoteURL, pat)
	if err := runGit(repo, "pull", "--ff-only", authURL, ns.DefaultBranch); err != nil {
		return fmt.Errorf("pull: %w", err)
	}
	return nil
}

func (s *Service) Fetch(ctx context.Context, id uuid.UUID, pat string) error {
	ns, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if !ns.HasRemote || ns.RemoteURL == nil {
		return fmt.Errorf("%w: namespace has no remote", ErrValidation)
	}
	repo := s.RepoPath(id)
	authURL := withPAT(*ns.RemoteURL, pat)
	if err := runGit(repo, "fetch", authURL); err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	return nil
}

func withPAT(remoteURL, pat string) string {
	pat = strings.TrimSpace(pat)
	if pat == "" {
		return remoteURL
	}
	u, err := url.Parse(remoteURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return remoteURL
	}
	u.User = url.UserPassword("x-access-token", pat)
	return u.String()
}

func pushWithAskpass(repo, pat, branch string) error {
	if strings.TrimSpace(pat) == "" {
		return runGit(repo, "push", "-u", "origin", "HEAD:"+branch)
	}
	script := filepath.Join(os.TempDir(), "terraforge-askpass.sh")
	content := "#!/bin/sh\necho '" + strings.ReplaceAll(pat, "'", `'\''`) + "'\n"
	if err := os.WriteFile(script, []byte(content), 0o700); err != nil {
		return err
	}
	defer os.Remove(script)
	cmd := execGitEnv(repo, map[string]string{
		"GIT_ASKPASS": script,
		"GIT_TERMINAL_PROMPT": "0",
	}, "push", "-u", "origin", "HEAD:"+branch)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git push: %w (%s)", err, string(out))
	}
	return nil
}
