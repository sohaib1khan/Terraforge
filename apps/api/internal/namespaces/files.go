package namespaces

import (
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

const maxFileBytes = 1 << 20 // 1 MiB

var (
	ErrInvalidPath = fmt.Errorf("%w: invalid file path", ErrValidation)
	ErrFileTooBig  = fmt.Errorf("%w: file exceeds 1 MiB limit", ErrValidation)
)

type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // file | dir
	Children []FileNode `json:"children,omitempty"`
}

type FileContent struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	CommitSHA string `json:"commit_sha,omitempty"`
}

func (s *Service) ListFiles(nsID string) (FileNode, error) {
	root := s.repoPath(nsID)
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return FileNode{}, ErrNotFound
		}
		return FileNode{}, err
	}
	return buildTree(root, ".")
}

func (s *Service) ReadFile(nsID, relPath string) (FileContent, error) {
	full, err := s.safePath(nsID, relPath)
	if err != nil {
		return FileContent{}, err
	}
	info, err := os.Stat(full)
	if err != nil {
		if os.IsNotExist(err) {
			return FileContent{}, ErrNotFound
		}
		return FileContent{}, err
	}
	if info.IsDir() {
		return FileContent{}, fmt.Errorf("%w: path is a directory", ErrValidation)
	}
	if info.Size() > maxFileBytes {
		return FileContent{}, ErrFileTooBig
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return FileContent{}, err
	}
	sha, _ := s.headSHA(nsID)
	return FileContent{
		Path:      filepath.ToSlash(filepath.Clean(relPath)),
		Content:   string(data),
		CommitSHA: sha,
	}, nil
}

func (s *Service) WriteFile(nsID, relPath, content, message string) (FileContent, error) {
	full, err := s.safePath(nsID, relPath)
	if err != nil {
		return FileContent{}, err
	}
	if len(content) > maxFileBytes {
		return FileContent{}, ErrFileTooBig
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return FileContent{}, err
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		return FileContent{}, err
	}

	repo := s.repoPath(nsID)
	clean := filepath.ToSlash(filepath.Clean(relPath))
	if err := runGit(repo, "add", "--", clean); err != nil {
		return FileContent{}, err
	}
	if message == "" {
		message = "Update " + clean
	}

	diff := exec.Command("git", "diff", "--cached", "--quiet")
	diff.Dir = repo
	if err := diff.Run(); err == nil {
		sha, _ := s.headSHA(nsID)
		return FileContent{Path: clean, Content: content, CommitSHA: sha}, nil
	} else if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		return FileContent{}, fmt.Errorf("git diff --cached: %w", err)
	}

	if err := runGit(repo, "commit", "-m", message); err != nil {
		return FileContent{}, err
	}
	sha, err := s.headSHA(nsID)
	if err != nil {
		return FileContent{}, err
	}
	return FileContent{Path: clean, Content: content, CommitSHA: sha}, nil
}

func (s *Service) DeleteFile(nsID, relPath, message string) (string, error) {
	full, err := s.safePath(nsID, relPath)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(full); err != nil {
		if os.IsNotExist(err) {
			return "", ErrNotFound
		}
		return "", err
	}
	repo := s.repoPath(nsID)
	clean := filepath.ToSlash(filepath.Clean(relPath))
	if err := runGit(repo, "rm", "-r", "--", clean); err != nil {
		if removeErr := os.RemoveAll(full); removeErr != nil {
			return "", err
		}
		return s.headSHA(nsID)
	}
	if message == "" {
		message = "Delete " + clean
	}
	if err := runGit(repo, "commit", "-m", message); err != nil {
		return "", err
	}
	return s.headSHA(nsID)
}

func (s *Service) headSHA(nsID string) (string, error) {
	out, err := runGitOutput(s.repoPath(nsID), "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// HeadSHA returns the current HEAD commit for a namespace repo.
func (s *Service) HeadSHA(id uuid.UUID) (string, error) {
	return s.headSHA(id.String())
}

func (s *Service) safePath(nsID, relPath string) (string, error) {
	relPath = strings.TrimSpace(relPath)
	relPath = strings.TrimPrefix(relPath, "/")
	if relPath == "" || relPath == "." {
		return "", ErrInvalidPath
	}
	clean := filepath.Clean(relPath)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", ErrInvalidPath
	}
	if filepath.IsAbs(clean) {
		return "", ErrInvalidPath
	}
	slash := filepath.ToSlash(clean)
	if slash == ".git" || strings.HasPrefix(slash, ".git/") {
		return "", ErrInvalidPath
	}

	root, err := filepath.Abs(s.repoPath(nsID))
	if err != nil {
		return "", err
	}
	full := filepath.Join(root, clean)
	fullAbs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	sep := string(filepath.Separator)
	if fullAbs != root && !strings.HasPrefix(fullAbs, root+sep) {
		return "", ErrInvalidPath
	}
	return fullAbs, nil
}

func buildTree(root, rel string) (FileNode, error) {
	full := filepath.Join(root, rel)
	info, err := os.Stat(full)
	if err != nil {
		return FileNode{}, err
	}
	name := info.Name()
	if rel == "." {
		name = ""
	}
	node := FileNode{
		Name: name,
		Path: filepath.ToSlash(rel),
		Type: "dir",
	}
	if !info.IsDir() {
		node.Type = "file"
		return node, nil
	}

	entries, err := os.ReadDir(full)
	if err != nil {
		return FileNode{}, err
	}
	for _, e := range entries {
		if e.Name() == ".git" {
			continue
		}
		childRel := e.Name()
		if rel != "." {
			childRel = filepath.Join(rel, e.Name())
		}
		if e.IsDir() {
			child, err := buildTree(root, childRel)
			if err != nil {
				return FileNode{}, err
			}
			node.Children = append(node.Children, child)
			continue
		}
		if e.Type()&fs.ModeSymlink != 0 {
			continue
		}
		node.Children = append(node.Children, FileNode{
			Name: e.Name(),
			Path: filepath.ToSlash(childRel),
			Type: "file",
		})
	}
	if node.Children == nil {
		node.Children = []FileNode{}
	}
	return node, nil
}
