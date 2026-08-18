package apiclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

type Run struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Type   string `json:"type"`
	Source string `json:"source"`
}

func New(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 60 * time.Second},
	}
}

func (c *Client) CreateRun(namespaceID, runType string) (Run, error) {
	var run Run
	err := c.doJSON(http.MethodPost, "/api/namespaces/"+namespaceID+"/runs", map[string]string{
		"type":   runType,
		"source": "cli",
	}, &run)
	return run, err
}

func (c *Client) AppendLogs(namespaceID, runID string, lines []string) error {
	return c.doJSON(http.MethodPost, "/api/namespaces/"+namespaceID+"/runs/"+runID+"/logs", map[string]any{
		"lines": lines,
	}, nil)
}

func (c *Client) Complete(namespaceID, runID, status string) (Run, error) {
	var run Run
	err := c.doJSON(http.MethodPost, "/api/namespaces/"+namespaceID+"/runs/"+runID+"/complete", map[string]string{
		"status": status,
	}, &run)
	return run, err
}

func (c *Client) Health() error {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+"/healthz", nil)
	if err != nil {
		return err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("healthz: %s", res.Status)
	}
	return nil
}

func (c *Client) CLICheck(namespaceID string) error {
	return c.doJSON(http.MethodGet, "/api/namespaces/"+namespaceID+"/cli-check", nil, nil)
}

func (c *Client) doJSON(method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("api %s %s: %s (%s)", method, path, res.Status, string(data))
	}
	if out == nil || res.StatusCode == http.StatusNoContent || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}
