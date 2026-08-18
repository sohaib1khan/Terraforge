package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func Slack(ctx context.Context, webhookURL, text string) error {
	webhookURL = strings.TrimSpace(webhookURL)
	if webhookURL == "" {
		return nil
	}
	if !strings.HasPrefix(webhookURL, "https://hooks.slack.com/") {
		return fmt.Errorf("invalid slack webhook url")
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("slack webhook status %s", res.Status)
	}
	return nil
}

func FormatRunMessage(namespace, runType, status, runID string, summary map[string]any) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("*Terraforge* `%s` · `%s` → `%s`\n", namespace, runType, status))
	b.WriteString(fmt.Sprintf("Run: `%s`", runID))
	if summary != nil {
		if added, ok := asInt(summary["added"]); ok {
			changed, _ := asInt(summary["changed"])
			destroyed, _ := asInt(summary["destroyed"])
			b.WriteString(fmt.Sprintf("\nPlan: `+%d` `~%d` `-%d`", added, changed, destroyed))
		}
		if drift, _ := summary["drift"].(bool); drift {
			b.WriteString("\n_Drift check_")
		}
	}
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
