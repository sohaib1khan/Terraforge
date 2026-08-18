#!/bin/sh
set -eu

cd /workspace

echo "==> terraforge runner: ${RUN_TYPE:-unknown}"

case "${RUN_TYPE}" in
  init)
    terraform init -input=false -no-color
    ;;
  plan)
    terraform init -input=false -no-color
    terraform plan -input=false -no-color -out=tfplan
    mkdir -p .terraforge
    terraform show -json tfplan > .terraforge/plan.json
    echo "==> wrote .terraforge/plan.json"
    ;;
  apply)
    terraform init -input=false -no-color
    terraform apply -input=false -no-color -auto-approve
    ;;
  destroy)
    terraform init -input=false -no-color
    terraform destroy -input=false -no-color -auto-approve
    ;;
  *)
    echo "unknown RUN_TYPE: ${RUN_TYPE:-}" >&2
    exit 2
    ;;
esac

echo "==> done"
