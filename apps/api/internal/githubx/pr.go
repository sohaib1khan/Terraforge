package githubx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type PRRef struct {
	Owner  string
	Repo   string
	Number int
}

func ParsePRFromPayload(event string, body []byte) (PRRef, map[string]any, bool) {
	meta := map[string]any{}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return PRRef{}, nil, false
	}

	event = strings.ToLower(strings.TrimSpace(event))
	switch event {
	case "pull_request", "pull_request_review", "pull_request_target":
		pr, _ := payload["pull_request"].(map[string]any)
		repo, _ := payload["repository"].(map[string]any)
		if pr == nil || repo == nil {
			return PRRef{}, nil, false
		}
		action, _ := payload["action"].(string)
		if action != "" && action != "opened" && action != "synchronize" && action != "reopened" && action != "ready_for_review" {
			return PRRef{}, nil, false
		}
		ref, ok := refFromMaps(pr, repo)
		if !ok {
			return PRRef{}, nil, false
		}
		meta["github_pr"] = ref.Number
		meta["github_repo"] = ref.Owner + "/" + ref.Repo
		if sha, _ := nestedString(pr, "head", "sha"); sha != "" {
			meta["github_sha"] = sha
		}
		return ref, meta, true
	case "push", "":
		// no PR
		return PRRef{}, nil, false
	default:
		return PRRef{}, nil, false
	}
}

func ShouldPlan(event string, body []byte) bool {
	event = strings.ToLower(strings.TrimSpace(event))
	if event == "" || event == "push" {
		return true
	}
	if event == "pull_request" || event == "pull_request_target" {
		_, _, ok := ParsePRFromPayload(event, body)
		return ok
	}
	var payload map[string]any
	_ = json.Unmarshal(body, &payload)
	if t, _ := payload["object_kind"].(string); t == "push" || t == "merge_request" {
		return true
	}
	return false
}

func refFromMaps(pr, repo map[string]any) (PRRef, bool) {
	num, _ := pr["number"].(float64)
	full, _ := repo["full_name"].(string)
	parts := strings.SplitN(full, "/", 2)
	if len(parts) != 2 || int(num) <= 0 {
		return PRRef{}, false
	}
	return PRRef{Owner: parts[0], Repo: parts[1], Number: int(num)}, true
}

func nestedString(m map[string]any, keys ...string) (string, bool) {
	cur := any(m)
	for _, k := range keys {
		obj, ok := cur.(map[string]any)
		if !ok {
			return "", false
		}
		cur = obj[k]
	}
	s, ok := cur.(string)
	return s, ok
}

func PostPRComment(ctx context.Context, token string, ref PRRef, body string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("missing github token")
	}
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues/%d/comments", ref.Owner, ref.Repo, ref.Number)
	payload, _ := json.Marshal(map[string]string{"body": body})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "terraforge")

	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("github comment failed: %s: %s", res.Status, string(b))
	}
	return nil
}

func FormatPlanComment(runID string, status string, summary map[string]any) string {
	added, _ := asInt(summary["added"])
	changed, _ := asInt(summary["changed"])
	destroyed, _ := asInt(summary["destroyed"])
	hasChanges, _ := summary["has_changes"].(bool)
	var b strings.Builder
	b.WriteString("### Terraforge plan\n\n")
	b.WriteString(fmt.Sprintf("- **Status:** `%s`\n", status))
	b.WriteString(fmt.Sprintf("- **Run:** `%s`\n", runID))
	b.WriteString(fmt.Sprintf("- **Changes:** `+%d` `~%d` `-%d`", added, changed, destroyed))
	if !hasChanges && added+changed+destroyed == 0 {
		b.WriteString(" (no changes)")
	}
	b.WriteString("\n")
	return b.String()
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}
