from __future__ import annotations

import random

from .genesis import BASE_PRICES, SERVICES
from .models import Demand, EconomyState, Offer, Transaction


def generate_epoch_intents(state: EconomyState) -> tuple[list[Offer], list[Demand]]:
    rng = random.Random(state.seed * 1_000_003 + state.epoch * 97_409)
    offers: list[Offer] = []
    demands: list[Demand] = []

    for agent in sorted(state.agents, key=lambda item: item.agent_id):
        if not agent.active:
            continue
        own_base = agent.reservation_prices.get(agent.specialty, BASE_PRICES[agent.specialty])
        utilization_signal = 1.0 + min(agent.completed_sales, 20) * 0.002
        offer_price = max(0.01, own_base * utilization_signal * rng.uniform(0.97, 1.03))
        offers.append(
            Offer(
                seller=agent.agent_id,
                service=agent.specialty,
                quantity=round(max(0.25, agent.productivity * rng.uniform(0.75, 1.25)), 6),
                unit_price=round(offer_price, 6),
            )
        )

        if rng.random() <= agent.spend_propensity:
            desired = SERVICES[rng.randrange(len(SERVICES))]
            if desired == agent.specialty:
                desired = SERVICES[(SERVICES.index(desired) + 1 + rng.randrange(len(SERVICES) - 1)) % len(SERVICES)]
            quantity = round(rng.uniform(0.25, 1.5), 6)
            willingness = BASE_PRICES[desired] * agent.price_sensitivity * rng.uniform(0.95, 1.25)
            affordable_ceiling = agent.balance / max(quantity, 1e-9)
            demands.append(
                Demand(
                    buyer=agent.agent_id,
                    service=desired,
                    quantity=quantity,
                    max_unit_price=round(min(willingness, affordable_ceiling), 6),
                )
            )

    return offers, demands


def clear_market(
    state: EconomyState, offers: list[Offer], demands: list[Demand]
) -> list[Transaction]:
    agents = {agent.agent_id: agent for agent in state.agents}
    books: dict[str, list[Offer]] = {service: [] for service in SERVICES}
    for offer in offers:
        books.setdefault(offer.service, []).append(Offer(**offer.to_dict()))
    for book in books.values():
        book.sort(key=lambda item: (item.unit_price, item.seller))

    transactions: list[Transaction] = []
    tx_counter = 0
    for demand in sorted(demands, key=lambda item: (item.service, item.buyer)):
        buyer = agents.get(demand.buyer)
        if buyer is None or not buyer.active or buyer.balance <= 0:
            continue
        remaining = demand.quantity
        for offer in books.get(demand.service, []):
            if remaining <= 1e-9:
                break
            if offer.quantity <= 1e-9 or offer.seller == demand.buyer:
                continue
            if offer.unit_price > demand.max_unit_price + 1e-12:
                break
            seller = agents.get(offer.seller)
            if seller is None or not seller.active:
                continue
            max_affordable_quantity = buyer.balance / offer.unit_price
            quantity = min(remaining, offer.quantity, max_affordable_quantity)
            if quantity <= 1e-9:
                continue
            amount = round(quantity * offer.unit_price, 6)
            if amount > buyer.balance + 1e-9:
                continue
            quantity = round(quantity, 6)
            buyer.balance = round(buyer.balance - amount, 6)
            seller.balance = round(seller.balance + amount, 6)
            buyer.completed_purchases += 1
            seller.completed_sales += 1
            offer.quantity = round(offer.quantity - quantity, 6)
            remaining = round(remaining - quantity, 6)
            tx_counter += 1
            transactions.append(
                Transaction(
                    tx_id=f"e{state.epoch:08d}-t{tx_counter:06d}",
                    epoch=state.epoch,
                    buyer=buyer.agent_id,
                    seller=seller.agent_id,
                    service=demand.service,
                    quantity=quantity,
                    unit_price=round(offer.unit_price, 6),
                    amount=amount,
                    kind="trade",
                )
            )
    return transactions
