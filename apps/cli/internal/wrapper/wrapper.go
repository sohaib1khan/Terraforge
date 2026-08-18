package wrapper

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"

	"github.com/terraforge/terraforge/apps/cli/internal/apiclient"
)

func Run(client *apiclient.Client, namespaceID, runType string, tfArgs []string) error {
	run, err := client.CreateRun(namespaceID, runType)
	if err != nil {
		return fmt.Errorf("register run: %w", err)
	}
	fmt.Fprintf(os.Stderr, "==> terraforge: registered %s run %s\n", runType, run.ID)

	args := append([]string{runType, "-json", "-no-color"}, tfArgs...)
	if runType == "apply" || runType == "destroy" {
		args = append([]string{runType, "-json", "-no-color", "-auto-approve"}, tfArgs...)
	}
	if runType == "init" {
		args = append([]string{"init", "-json", "-no-color", "-input=false"}, tfArgs...)
	}

	cmd := exec.Command("terraform", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		_, _ = client.Complete(namespaceID, run.ID, "failed")
		return fmt.Errorf("start terraform: %w", err)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		_ = cmd.Process.Signal(os.Interrupt)
	}()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		stream(stdout, client, namespaceID, run.ID, os.Stdout)
	}()
	go func() {
		defer wg.Done()
		stream(stderr, client, namespaceID, run.ID, os.Stderr)
	}()
	wg.Wait()

	waitErr := cmd.Wait()
	status := "success"
	if waitErr != nil {
		status = "failed"
	}
	if _, err := client.Complete(namespaceID, run.ID, status); err != nil {
		fmt.Fprintf(os.Stderr, "==> terraforge: failed to report status: %v\n", err)
	}
	return waitErr
}

func stream(r io.Reader, client *apiclient.Client, namespaceID, runID string, echo io.Writer) {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	batch := make([]string, 0, 20)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		_ = client.AppendLogs(namespaceID, runID, batch)
		batch = batch[:0]
	}
	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintln(echo, line)
		batch = append(batch, line)
		if len(batch) >= 20 {
			flush()
		}
	}
	flush()
}
