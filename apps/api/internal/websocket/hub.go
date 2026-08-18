package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[*websocket.Conn]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[*websocket.Conn]struct{})}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type logMessage struct {
	Type   string `json:"type"`
	Line   string `json:"line,omitempty"`
	Status string `json:"status,omitempty"`
}

func (h *Hub) Subscribe(runID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[runID] == nil {
		h.subs[runID] = make(map[*websocket.Conn]struct{})
	}
	h.subs[runID][conn] = struct{}{}
}

func (h *Hub) Unsubscribe(runID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m, ok := h.subs[runID]; ok {
		delete(m, conn)
		if len(m) == 0 {
			delete(h.subs, runID)
		}
	}
}

func (h *Hub) PublishLine(runID, line string) {
	h.broadcast(runID, logMessage{Type: "log", Line: line})
}

func (h *Hub) PublishStatus(runID, status string) {
	h.broadcast(runID, logMessage{Type: "status", Status: status})
}

func (h *Hub) broadcast(runID string, msg logMessage) {
	body, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	conns := make([]*websocket.Conn, 0, len(h.subs[runID]))
	for conn := range h.subs[runID] {
		conns = append(conns, conn)
	}
	h.mu.RUnlock()
	for _, conn := range conns {
		if err := conn.WriteMessage(websocket.TextMessage, body); err != nil {
			log.Printf("websocket write: %v", err)
			_ = conn.Close()
			h.Unsubscribe(runID, conn)
		}
	}
}

// ServeWS upgrades the connection, optionally sends catch-up lines, then streams live events.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, runID string, catchUp func(publish func(line string))) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.Subscribe(runID, conn)
	defer func() {
		h.Unsubscribe(runID, conn)
		_ = conn.Close()
	}()

	if catchUp != nil {
		catchUp(func(line string) {
			body, _ := json.Marshal(logMessage{Type: "log", Line: line})
			_ = conn.WriteMessage(websocket.TextMessage, body)
		})
	}

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
