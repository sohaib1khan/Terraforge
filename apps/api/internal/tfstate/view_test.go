package tfstate

import (
	"testing"
	"time"
)

func TestBuildViewConnected(t *testing.T) {
	now := time.Now()
	state := []byte(`{
		"version": 4,
		"terraform_version": "1.9.0",
		"serial": 1,
		"resources": [
			{
				"mode": "managed",
				"type": "aws_vpc",
				"name": "main",
				"provider": "provider[\"registry.terraform.io/hashicorp/aws\"]",
				"instances": [{"attributes": {"id": "vpc-123"}}]
			}
		]
	}`)

	tests := []struct {
		name          string
		state         []byte
		updatedAt     *time.Time
		lock          *LockInfo
		wantExists    bool
		wantConnected bool
		wantResources int
	}{
		{name: "no backend row at all"},
		{
			name:          "row exists from a lock but nothing applied",
			updatedAt:     &now,
			wantConnected: true,
		},
		{
			name:          "lock held while state is still empty",
			lock:          &LockInfo{ID: "abc"},
			wantConnected: true,
		},
		{
			name:          "state uploaded",
			state:         state,
			updatedAt:     &now,
			wantExists:    true,
			wantConnected: true,
			wantResources: 1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			v := BuildView(tc.state, tc.updatedAt, tc.lock)
			if v.Exists != tc.wantExists {
				t.Errorf("Exists = %v, want %v", v.Exists, tc.wantExists)
			}
			if v.Connected != tc.wantConnected {
				t.Errorf("Connected = %v, want %v", v.Connected, tc.wantConnected)
			}
			if v.ResourceCount != tc.wantResources {
				t.Errorf("ResourceCount = %d, want %d", v.ResourceCount, tc.wantResources)
			}
		})
	}
}
