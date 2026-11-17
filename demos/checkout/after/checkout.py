def calculate_total(items):
    """Calculate a checkout total using whole cents.

    Each item has a nonnegative integer price_cents and positive quantity.
    Orders of at least 5000 cents get 10% off, rounded down to whole cents.
    Delivery is free when the discounted subtotal is at least 5000 cents;
    otherwise it costs 500 cents. An empty basket costs nothing.
    """
    if not items:
        return 0

    subtotal = 0
    for item in items:
        subtotal += item["price_cents"] * item["quantity"]

    discount = 0
    if subtotal >= 5000:
        discount = subtotal * 10 // 100

    discounted_subtotal = subtotal - discount

    delivery = 500
    if discounted_subtotal >= 5000:
        delivery = 0

    return discounted_subtotal + delivery


if __name__ == "__main__":
    basket = [{"price_cents": 2500, "quantity": 2}]
    print(calculate_total(basket))
