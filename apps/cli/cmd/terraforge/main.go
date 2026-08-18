package main

import (
	"fmt"
	"os"
	"time"

	"github.com/terraforge/terraforge/apps/cli/internal/apiclient"
	"github.com/terraforge/terraforge/apps/cli/internal/config"
	"github.com/terraforge/terraforge/apps/cli/internal/connect"
	"github.com/terraforge/terraforge/apps/cli/internal/syncx"
	"github.com/terraforge/terraforge/apps/cli/internal/wrapper"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "config":
		if err := cmdConfig(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "connect":
		if err := cmdConnect(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "sync":
		if err := cmdSync(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "pull":
		if err := cmdPull(); err != nil {
			fatal(err)
		}
	case "status":
		if err := cmdStatus(); err != nil {
			fatal(err)
		}
	case "watch":
		if err := cmdWatch(os.Args[2:]); err != nil {
			fatal(err)
		}
	case "doctor":
		if err := cmdDoctor(); err != nil {
			fatal(err)
		}
	case "plan", "apply", "destroy", "init":
		if err := cmdRun(os.Args[1], os.Args[2:]); err != nil {
			fatal(err)
		}
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func cmdConnect(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: terraforge connect <install-url>\nexample: terraforge connect 'http://host:3000/api/connect/install/tfi_…/pack.tar.gz'")
	}
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	return connect.FromURL(args[0], wd)
}

func cmdConfig(args []string) error {
	if len(args) == 0 || args[0] != "set" {
		return fmt.Errorf("usage: terraforge config set --api-url URL --token TOKEN --namespace-id ID")
	}
	cfg := config.Config{}
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--api-url":
			i++
			cfg.APIURL = args[i]
		case "--token":
			i++
			cfg.Token = args[i]
		case "--namespace-id":
			i++
			cfg.NamespaceID = args[i]
		default:
			return fmt.Errorf("unknown flag %s", args[i])
		}
	}
	if cfg.APIURL == "" || cfg.Token == "" || cfg.NamespaceID == "" {
		return fmt.Errorf("api-url, token, and namespace-id are required")
	}
	if err := config.Save(cfg); err != nil {
		return err
	}
	path, _ := config.Path()
	fmt.Printf("wrote %s\n", path)
	fmt.Println("tip: api-url should be the website origin (e.g. http://host:3000), not :8088")
	return nil
}

func cmdDoctor() error {
	path, err := config.Path()
	if err != nil {
		return err
	}
	fmt.Printf("config file: %s\n", path)
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	fmt.Printf("api_url:      %s\n", cfg.APIURL)
	fmt.Printf("namespace_id: %s\n", cfg.NamespaceID)
	tokenPreview := cfg.Token
	if len(tokenPreview) > 12 {
		tokenPreview = tokenPreview[:12] + "…"
	}
	fmt.Printf("token:        %s (%s)\n", tokenPreview, tokenKind(cfg.Token))
	if tokenKind(cfg.Token) == "jwt" {
		fmt.Println("warning: browser JWT detected — prefer a connect-pack CLI token (tfc_…)")
	}

	client := apiclient.New(cfg.APIURL, cfg.Token)
	if err := client.Health(); err != nil {
		return fmt.Errorf("healthz failed (is api_url the website :3000?): %w", err)
	}
	fmt.Println("healthz:      ok")
	if err := client.CLICheck(cfg.NamespaceID); err != nil {
		return fmt.Errorf("cli-check failed: %w", err)
	}
	fmt.Println("cli-check:    ok")
	fmt.Println("doctor:       all good")
	return nil
}

func tokenKind(tok string) string {
	if len(tok) >= 4 && tok[:4] == "tfc_" {
		return "cli-token"
	}
	if len(tok) >= 4 && tok[:4] == "tfb_" {
		return "backend-token (wrong for CLI)"
	}
	return "jwt"
}

func cmdSync(args []string) error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	if len(args) > 0 && args[0] == "status" {
		return syncx.PrintStatus(wd)
	}
	return syncx.PushDir(wd)
}

func cmdPull() error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	return syncx.PullDir(wd)
}

func cmdStatus() error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	return syncx.PrintStatus(wd)
}

func cmdWatch(args []string) error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}
	every := 5 * time.Second
	for i := 0; i < len(args); i++ {
		if args[i] == "--every" && i+1 < len(args) {
			d, err := time.ParseDuration(args[i+1])
			if err != nil {
				return err
			}
			every = d
			i++
		}
	}
	return syncx.Watch(wd, every)
}

func cmdRun(runType string, tfArgs []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := apiclient.New(cfg.APIURL, cfg.Token)
	return wrapper.Run(client, cfg.NamespaceID, runType, tfArgs)
}

func usage() {
	fmt.Fprintf(os.Stderr, `terraforge — companion CLI for Terraforge

Preferred: generate a curl one-liner in the dashboard, then either:
  curl -fsSL 'http://host:3000/api/connect/install/CODE' | sh
or (safer, no shell pipe):
  terraforge connect 'http://host:3000/api/connect/install/CODE/pack.tar.gz'

Usage:
  terraforge connect <install-tarball-url>
  terraforge sync              # push local → Terraforge
  terraforge pull              # pull Terraforge → local
  terraforge status            # sync checklist + digests
  terraforge watch [--every 5s]  # auto keep both sides in sync
  terraforge doctor
  terraforge config set --api-url URL --token tfc_… --namespace-id UUID
  terraforge init|plan|apply|destroy

Tip: leave terraforge watch running while editing in the dashboard so local stays updated.

api-url must be the website origin (e.g. http://localhost:3000 or http://<host>:<APP_PORT>).
Project: https://github.com/sohaib1khan/Terraforge
`)
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}
