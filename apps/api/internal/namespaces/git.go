package namespaces

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/google/uuid"
)

func (s *Service) repoPath(id string) string {
	return filepath.Join(s.dataDir, "namespaces", id)
}

// RepoPath returns the absolute filesystem path for a namespace git repo.
func (s *Service) RepoPath(id uuid.UUID) string {
	abs, err := filepath.Abs(s.repoPath(id.String()))
	if err != nil {
		return s.repoPath(id.String())
	}
	return abs
}

func (s *Service) initLocalRepo(id, defaultBranch string) error {
	dir := s.repoPath(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir repo: %w", err)
	}

	if err := runGit(dir, "init", "-b", defaultBranch); err != nil {
		return err
	}
	if err := runGit(dir, "config", "user.email", "terraforge@local"); err != nil {
		return err
	}
	if err := runGit(dir, "config", "user.name", "Terraforge"); err != nil {
		return err
	}

	// Seed an empty tree so HEAD exists before the editor creates files.
	readme := filepath.Join(dir, "README.md")
	content := "# Terraforge namespace\n\nLocal-only workspace managed by Terraforge.\n"
	if err := os.WriteFile(readme, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write readme: %w", err)
	}
	if err := runGit(dir, "add", "README.md"); err != nil {
		return err
	}
	if err := runGit(dir, "commit", "-m", "Initial commit"); err != nil {
		return err
	}
	return nil
}

func (s *Service) removeLocalRepo(id string) error {
	dir := s.repoPath(id)
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("remove repo: %w", err)
	}
	return nil
}

func runGit(dir string, args ...string) error {
	_, err := runGitOutput(dir, args...)
	return err
}

func runGitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %v: %w (%s)", args, err, string(out))
	}
	return string(out), nil
}

func execGitEnv(dir string, env map[string]string, args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	return cmd
}
