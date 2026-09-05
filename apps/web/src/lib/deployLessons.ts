/**
 * Teaching content for the Playground live-deploy dashboard.
 * Data only — the DeployMap component decides what to show when.
 */

export type LifecycleId = 'write' | 'init' | 'plan' | 'apply' | 'destroy'

export type LifecycleStep = {
  id: LifecycleId
  label: string
  command: string
  /** One line for the stepper chip. */
  short: string
  /** What Terraform actually does under the hood. */
  what: string
  /** What to look for in the output while it runs. */
  watch: string
  /** House-building analogy used by the illustration. */
  analogy: string
  /** Files / artifacts touched. */
  touches: string
}

export const LIFECYCLE: LifecycleStep[] = [
  {
    id: 'write',
    label: 'Write',
    command: 'edit *.tf',
    short: 'Describe the desired end state',
    what:
      'You declare what should exist, not the steps to get there. Terraform reads every .tf file in the folder as one configuration and builds a dependency graph from the references between blocks.',
    watch:
      'Each resource block is "type" + "name" — together they form the resource address, e.g. local_file.vm_manifest.',
    analogy: 'Deciding what the house should look like before anyone shows up with tools.',
    touches: 'main.tf, variables.tf, terraform.tfvars, outputs.tf',
  },
  {
    id: 'init',
    label: 'Init',
    command: 'terraform init',
    short: 'Download providers, prepare the backend',
    what:
      'Terraform reads required_providers, downloads each provider plugin into .terraform/, records exact versions in .terraform.lock.hcl, and initializes the state backend. Safe to re-run any time.',
    watch:
      'Lines like "Installing hashicorp/local v2.5.x" and "Terraform has been successfully initialized".',
    analogy: 'Tools and materials delivered to the empty lot before work starts.',
    touches: '.terraform/, .terraform.lock.hcl',
  },
  {
    id: 'plan',
    label: 'Plan',
    command: 'terraform plan',
    short: 'Diff desired state against reality',
    what:
      'Terraform refreshes what it knows from state, compares it to your configuration, and prints the exact set of changes it would make. Nothing is created or destroyed by a plan.',
    watch:
      'The action symbols: + create, ~ update in place, - destroy, -/+ replace. Then the summary line "Plan: N to add, N to change, N to destroy".',
    analogy: 'Architects drawing the blueprint and listing every part to be built.',
    touches: 'reads state; writes nothing (unless you pass -out)',
  },
  {
    id: 'apply',
    label: 'Apply',
    command: 'terraform apply',
    short: 'Make reality match the config',
    what:
      'Terraform walks the dependency graph and creates or updates resources — independent ones in parallel, dependent ones in order. Every result is recorded in state as it completes.',
    watch:
      'Per-resource progress: "Creating..." then "Creation complete after 0s". The parts list on the right lights up from the same log lines.',
    analogy: 'Crews pour the foundation, raise the walls, then set the roof.',
    touches: 'writes state, creates real resources, prints outputs',
  },
  {
    id: 'destroy',
    label: 'Destroy',
    command: 'terraform destroy',
    short: 'Remove everything in state',
    what:
      'Terraform destroys managed resources in reverse dependency order, so dependents go before the things they depend on. Only resources tracked in state are touched.',
    watch: 'Lines like "Destroying..." then "Destruction complete", and the final "Destroy complete! N destroyed".',
    analogy: 'Taking the house down piece by piece, back to a bare lot.',
    touches: 'removes resources, empties state',
  },
]

export function lifecycleStep(id: LifecycleId): LifecycleStep {
  return LIFECYCLE.find((s) => s.id === id) ?? LIFECYCLE[0]
}

export type Concept = {
  term: string
  short: string
  detail: string
}

export const CONCEPTS: Concept[] = [
  {
    term: 'State',
    short: 'Terraform’s memory',
    detail:
      'A JSON record mapping each resource address in your config to the real object it created. Terraform diffs config against state to decide what to change — which is why deleting state is not the same as destroying resources.',
  },
  {
    term: 'Provider',
    short: 'The plugin that does the work',
    detail:
      'Providers translate Terraform resource blocks into real API calls. local and random need no credentials, which is why the Playground uses them; aws or azurerm would need auth.',
  },
  {
    term: 'Resource address',
    short: 'type.name',
    detail:
      'The unique handle for a resource in your config, like local_file.vm_manifest. Terraform uses it in plan output, state, logs, and commands such as terraform taint or -target.',
  },
  {
    term: 'Dependency graph',
    short: 'Order is derived, not written',
    detail:
      'Referencing one resource from another (random_id.instance.hex) creates an edge. Terraform topologically sorts those edges, so you never write step-by-step ordering yourself.',
  },
  {
    term: 'Idempotency',
    short: 'Re-running is safe',
    detail:
      'Apply again with no config change and Terraform reports "No changes". The config describes a destination, so repeating the trip from the destination is a no-op.',
  },
  {
    term: 'Drift',
    short: 'Reality moved without you',
    detail:
      'If something changes a resource outside Terraform, the next plan shows a difference between state and reality. That gap is drift, and plan is how you detect it.',
  },
  {
    term: 'Plan symbols',
    short: '+ ~ - and -/+',
    detail:
      '+ creates, ~ updates in place, - destroys, and -/+ means the change forces a replacement: destroy then create, because the provider cannot alter that attribute live.',
  },
  {
    term: 'Outputs',
    short: 'Values you export',
    detail:
      'output blocks surface computed values (IDs, paths, endpoints) after apply, for humans to read or for other configurations to consume via remote state.',
  },
]
