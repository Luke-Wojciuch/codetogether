def calculate_total(items):
    """Return the subtotal in whole cents for the supplied items."""
    return sum(item["price_cents"] * item["quantity"] for item in items)
