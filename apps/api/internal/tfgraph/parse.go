package tfgraph

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type NodeKind string

const (
	KindResource NodeKind = "resource"
	KindData     NodeKind = "data"
	KindModule   NodeKind = "module"
	KindVariable NodeKind = "variable"
	KindOutput   NodeKind = "output"
	KindLocal    NodeKind = "local"
)

type Node struct {
	ID       string   `json:"id"`
	Kind     NodeKind `json:"kind"`
	Label    string   `json:"label"`
	Type     string   `json:"type,omitempty"`
	Name     string   `json:"name"`
	File     string   `json:"file,omitempty"`
	InState  bool     `json:"in_state"`
	Provider string   `json:"provider,omitempty"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"` // reference
}

type Graph struct {
	Nodes        []Node       `json:"nodes"`
	Edges        []Edge       `json:"edges"`
	Files        int          `json:"files_scanned"`
	Note         string       `json:"note,omitempty"`
	HasState     bool         `json:"has_state"`
	Environment  Environment  `json:"environment"`
}

var (
	reBlock = regexp.MustCompile(`(?m)^(resource|data|module|variable|output|locals)\s*(?:"([^"]+)"\s*(?:"([^"]+)")?)?\s*\{`)
	reRef   = regexp.MustCompile(`\b((?:data\.)?[a-zA-Z0-9_]+\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?|module\.[a-zA-Z0-9_-]+|var\.[a-zA-Z0-9_-]+|local\.[a-zA-Z0-9_-]+)\b`)
)

// Build scans a Terraform working directory for blocks and references.
func Build(root string, stateAddrs map[string]bool) (Graph, error) {
	g := Graph{
		Nodes:    []Node{},
		Edges:    []Edge{},
		HasState: len(stateAddrs) > 0,
		Note:     "Static map from .tf / .tf.json files. References are inferred from HCL text (not a full terraform graph).",
	}
	if root == "" {
		return g, nil
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return g, err
	}

	nodes := map[string]Node{}
	var files int

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == ".terraform" || name == ".terraforge" || name == "terraforge_connect" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		base := d.Name()
		if !strings.HasSuffix(base, ".tf") && !strings.HasSuffix(base, ".tf.json") {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) > 1<<20 {
			return nil
		}
		files++
		parseFile(string(raw), rel, nodes)
		return nil
	})
	g.Files = files

	// Second pass: edges from body references
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			if d != nil && d.IsDir() {
				name := d.Name()
				if name == ".git" || name == ".terraform" || name == ".terraforge" || name == "terraforge_connect" {
					return filepath.SkipDir
				}
			}
			return nil
		}
		base := d.Name()
		if !strings.HasSuffix(base, ".tf") && !strings.HasSuffix(base, ".tf.json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		addEdges(string(raw), nodes, &g)
		return nil
	})

	for id, n := range nodes {
		if stateAddrs != nil {
			if stateAddrs[id] || stateAddrs[n.Label] {
				n.InState = true
			}
			// match resource.type.name and type.name
			if n.Kind == KindResource || n.Kind == KindData {
				if stateAddrs[n.Label] {
					n.InState = true
				}
			}
		}
		nodes[id] = n
	}

	for _, n := range nodes {
		g.Nodes = append(g.Nodes, n)
	}
	sort.Slice(g.Nodes, func(i, j int) bool {
		if g.Nodes[i].Kind != g.Nodes[j].Kind {
			return g.Nodes[i].Kind < g.Nodes[j].Kind
		}
		return g.Nodes[i].ID < g.Nodes[j].ID
	})
	dedupeEdges(&g)
	env := DetectEnvironment(root)
	EnrichEnvironmentFromGraph(&env, g)
	g.Environment = env
	return g, nil
}

func parseFile(src, file string, nodes map[string]Node) {
	matches := reBlock.FindAllStringSubmatchIndex(src, -1)
	for _, m := range matches {
		kind := src[m[2]:m[3]]
		var a, b string
		if m[4] >= 0 {
			a = src[m[4]:m[5]]
		}
		if m[6] >= 0 {
			b = src[m[6]:m[7]]
		}
		switch kind {
		case "resource":
			id := a + "." + b
			nodes[id] = Node{ID: id, Kind: KindResource, Label: id, Type: a, Name: b, File: file, Provider: providerFromType(a)}
		case "data":
			id := "data." + a + "." + b
			nodes[id] = Node{ID: id, Kind: KindData, Label: id, Type: a, Name: b, File: file, Provider: providerFromType(a)}
		case "module":
			id := "module." + a
			nodes[id] = Node{ID: id, Kind: KindModule, Label: id, Name: a, File: file}
		case "variable":
			id := "var." + a
			nodes[id] = Node{ID: id, Kind: KindVariable, Label: id, Name: a, File: file}
		case "output":
			id := "output." + a
			nodes[id] = Node{ID: id, Kind: KindOutput, Label: a, Name: a, File: file}
		case "locals":
			// locals { foo = ... } — extract simple identifiers at top of block body
			body := blockBody(src, m[1])
			for _, name := range localNames(body) {
				id := "local." + name
				nodes[id] = Node{ID: id, Kind: KindLocal, Label: id, Name: name, File: file}
			}
		}
	}
}

func addEdges(src string, nodes map[string]Node, g *Graph) {
	matches := reBlock.FindAllStringSubmatchIndex(src, -1)
	for i, m := range matches {
		kind := src[m[2]:m[3]]
		var a, b string
		if m[4] >= 0 {
			a = src[m[4]:m[5]]
		}
		if m[6] >= 0 {
			b = src[m[6]:m[7]]
		}
		from := ""
		switch kind {
		case "resource":
			from = a + "." + b
		case "data":
			from = "data." + a + "." + b
		case "module":
			from = "module." + a
		case "variable":
			continue // variables don't depend outbound in the same way
		case "output":
			from = "output." + a
		case "locals":
			from = ""
		}
		end := len(src)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		body := src[m[1]:end]
		if kind == "locals" {
			for _, name := range localNames(blockBody(src, m[1])) {
				from = "local." + name
				linkRefs(from, body, nodes, g)
			}
			continue
		}
		if from == "" {
			continue
		}
		linkRefs(from, body, nodes, g)
	}
}

func linkRefs(from, body string, nodes map[string]Node, g *Graph) {
	seen := map[string]bool{}
	for _, m := range reRef.FindAllString(body, -1) {
		to := normalizeRef(m)
		if to == "" || to == from || seen[to] {
			continue
		}
		// skip self-type noise like resource meta
		if strings.HasPrefix(to, from+".") {
			continue
		}
		if _, ok := nodes[to]; !ok {
			// try strip attribute: aws_instance.web.id → aws_instance.web
			parts := strings.Split(to, ".")
			if len(parts) >= 3 && parts[0] != "data" && parts[0] != "module" && parts[0] != "var" && parts[0] != "local" {
				cand := parts[0] + "." + parts[1]
				if _, ok := nodes[cand]; ok {
					to = cand
				}
			} else if len(parts) >= 4 && parts[0] == "data" {
				cand := "data." + parts[1] + "." + parts[2]
				if _, ok := nodes[cand]; ok {
					to = cand
				}
			} else if len(parts) >= 3 && parts[0] == "module" {
				cand := "module." + parts[1]
				if _, ok := nodes[cand]; ok {
					to = cand
				}
			}
		}
		if _, ok := nodes[to]; !ok {
			continue
		}
		if to == from {
			continue
		}
		seen[to] = true
		// Edge: from depends on to
		g.Edges = append(g.Edges, Edge{From: from, To: to, Kind: "reference"})
	}
}

func normalizeRef(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "var.") || strings.HasPrefix(s, "local.") || strings.HasPrefix(s, "module.") || strings.HasPrefix(s, "data.") {
		return s
	}
	// resource.type.name[.attr]
	return s
}

func blockBody(src string, openBrace int) string {
	// openBrace is index of '{'
	depth := 0
	for i := openBrace; i < len(src); i++ {
		switch src[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return src[openBrace+1 : i]
			}
		}
	}
	return src[openBrace+1:]
}

var reLocalAssign = regexp.MustCompile(`(?m)^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=`)

func localNames(body string) []string {
	var out []string
	seen := map[string]bool{}
	for _, m := range reLocalAssign.FindAllStringSubmatch(body, -1) {
		name := m[1]
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func providerFromType(t string) string {
	if i := strings.IndexByte(t, '_'); i > 0 {
		return t[:i]
	}
	return ""
}

func dedupeEdges(g *Graph) {
	seen := map[string]bool{}
	out := g.Edges[:0]
	for _, e := range g.Edges {
		key := e.From + "->" + e.To
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, e)
	}
	g.Edges = out
}

// StateAddrs extracts resource addresses from terraform state JSON.
func StateAddrs(state []byte) map[string]bool {
	out := map[string]bool{}
	if len(state) == 0 {
		return out
	}
	// lightweight: find "type"/"name" pairs via view-like parse reuse
	re := regexp.MustCompile(`"type"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"`)
	for _, m := range re.FindAllStringSubmatch(string(state), -1) {
		out[m[1]+"."+m[2]] = true
	}
	reAddr := regexp.MustCompile(`"address"\s*:\s*"([^"]+)"`)
	for _, m := range reAddr.FindAllStringSubmatch(string(state), -1) {
		out[m[1]] = true
	}
	return out
}
