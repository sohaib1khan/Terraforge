package runner

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var safeImage = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/-]*:[a-zA-Z0-9._-]+$`)

type LogFunc func(line string)

type Options struct {
	Image     string
	RepoPath  string
	RunType   string
	Timeout   time.Duration
	Container string
	Env       map[string]string
}

func Run(ctx context.Context, opts Options, onLog LogFunc) error {
	if !safeImage.MatchString(opts.Image) {
		return fmt.Errorf("invalid runner image %q", opts.Image)
	}
	switch opts.RunType {
	case "init", "plan", "apply", "destroy":
	default:
		return fmt.Errorf("invalid run type %q", opts.RunType)
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 10 * time.Minute
	}

	runCtx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	name := opts.Container
	if name == "" {
		name = "terraforge-run"
	}

	args := []string{
		"run", "--rm",
		"--name", name,
		"-v", opts.RepoPath + ":/workspace",
		"-w", "/workspace",
		"-e", "RUN_TYPE=" + opts.RunType,
	}
	for k, v := range opts.Env {
		if k == "" || strings.ContainsAny(k, "=\x00") {
			continue
		}
		args = append(args, "-e", k+"="+v)
	}
	args = append(args, opts.Image)

	cmd := exec.CommandContext(runCtx, "docker", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("docker start: %w", err)
	}

	errCh := make(chan error, 2)
	go stream(stdout, onLog, errCh)
	go stream(stderr, onLog, errCh)

	waitErr := cmd.Wait()
	<-errCh
	<-errCh

	if runCtx.Err() == context.DeadlineExceeded {
		_ = exec.Command("docker", "rm", "-f", name).Run()
		return fmt.Errorf("run timed out after %s", opts.Timeout)
	}
	if waitErr != nil {
		return fmt.Errorf("terraform %s failed: %w", opts.RunType, waitErr)
	}
	return nil
}

func stream(r io.Reader, onLog LogFunc, errCh chan<- error) {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if onLog != nil {
			onLog(line)
		}
	}
	if err := scanner.Err(); err != nil && !strings.Contains(err.Error(), "file already closed") {
		errCh <- err
		return
	}
	errCh <- nil
}
