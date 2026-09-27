# Generated Artifact Lifecycle

This owner contains recoverable lifecycle operations for generated build
products. Superseded products are moved beneath `temp/archives` with provenance
instead of being unlinked. Domain builders own the decision that an artifact is
superseded; this module owns only the collision-safe archive transaction.

Generic resource parsing and projection helpers do not belong here.
