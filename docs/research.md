# Adaptive-agent research

CYMONIA's canonical economy remains deterministic and rule based. The research runner is a separate, in-memory experiment: it creates canonical 100-agent Genesis states and advances them with the canonical `step_epoch` function, but it never reads or writes the persisted `state/` history. Its results therefore do not become canonical history.

The experiment compares two arms for every seed. The `baseline` arm keeps each agent's seeded Genesis `spend_propensity` fixed. In the `adaptive` arm, every agent independently chooses one of `0.2`, `0.4`, `0.6`, or `0.8` before each epoch. A seeded epsilon-greedy bandit explores with probability `0.12`; otherwise it chooses an action with the highest learned sample-average value. Seeded tie-breaking is reproducible. Both arms begin with the same complete Genesis state and publish the same `initial_state_hash` for a seed.

After an epoch finishes, each adaptive agent observes this toy reward:

```text
(balance change - equal policy issuance received
 + purchased quantity × canonical service base price) / Genesis initial balance
```

The purchased-service term is a declared utility proxy, not a market valuation or welfare measure. Policy issuance is removed from the balance change so an agent is not rewarded merely for receiving an equal monetary distribution. The action for epoch N is selected from values learned through epoch N-1; the trace exports `q_before`, the observed reward, and `q_after` to make that ordering inspectable.

Run the published study from the repository root:

```bash
python3 -m cymonia research --epochs 60 --seeds 11 29 47 --output site/data/experiments.json
```

The JSON includes the exact seed list, epochs, epsilon, action set, agent count, model identifier and update rule, constitution SHA-256, canonical macro history for each arm and seed, three agents' per-epoch decision traces, and final learned values and action counts for all 100 agents. The trace is deliberately bounded while the full population still learns. Summary values are descriptive seed means and mean paired differences (`adaptive - baseline`); the runner makes no significance or causal claims.

This is a small simulation with a short horizon, four discrete actions, one reward definition, and three precomputed seeds. Agent rewards are endogenous because agents trade with each other. The canonical policy rate does not directly affect demand or offers in the current market rules, so this study cannot estimate an interest-rate response. Results describe only this toy model and do not generalize to people, firms, or external economies. The bandits are adaptive statistical agents, not language models, human-like reasoners, or conscious entities.

## Interpreting the comparison

This is a comparison of two behavior regimes, not an isolated estimate of the benefit of learning. The baseline uses each agent's original continuous spending propensity; the adaptive arm selects from four discrete actions and starts with zero estimates. An action-space-matched, randomized non-learning arm would be needed to separate those effects. The shared seed guarantees the same initial state, but changing purchase decisions can change consumption of the market's random stream; it does not guarantee identical realized shocks at every later step.

The summary reports mean **final-epoch** GDP, Gini and transaction count, plus **whole-run** cumulative reward, with mean paired differences. A single final epoch can be noisy. Use the exported full trajectories for window averages, distributions, and longer-horizon analysis. The reward includes seller receipts as well as purchased-service utility; summing individual rewards therefore does not establish a social welfare optimum.
