---
name: telecom-domain
description: Use telecom vocabulary for orders, services, resources, fulfillment, and assurance without inventing operator-specific behavior.
---

# Telecom domain language

Distinguish facts, local conventions, and recommendations.

- A product is what a customer orders. A service is the technical capability delivered for that product. A resource is something the service depends on.
- An order is the customer request. A service order is the service-layer work that fulfills part of it. Do not collapse those records into one object unless the target code already does.
- Fulfillment makes a requested service available. Assurance keeps a live service healthy.
- Orchestration sequences that work. Inventory records what exists. Events notify downstream activation; they are not themselves the activation.

Local code wins when it uses a narrower definition. Say which file you relied on. Do not invent subscriber, telephone, or customer data.

Last verified: 2026-10-27 against `catalog/glossary.md`.
