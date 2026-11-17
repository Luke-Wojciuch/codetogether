import unittest

from checkout import calculate_total


class CheckoutTests(unittest.TestCase):
    def test_empty_basket(self):
        self.assertEqual(calculate_total([]), 0)

    def test_quantities_and_multiple_items(self):
        items = [{"price_cents": 1000, "quantity": 2},
                 {"price_cents": 500, "quantity": 1}]
        self.assertEqual(calculate_total(items), 3000)

    def test_just_below_discount_threshold(self):
        self.assertEqual(calculate_total(
            [{"price_cents": 4999, "quantity": 1}]), 5499)

    def test_discount_can_leave_delivery_charge(self):
        self.assertEqual(calculate_total(
            [{"price_cents": 2500, "quantity": 2}]), 5000)

    def test_delivery_threshold_uses_discounted_subtotal(self):
        self.assertEqual(calculate_total(
            [{"price_cents": 5555, "quantity": 1}]), 5000)
        self.assertEqual(calculate_total(
            [{"price_cents": 5554, "quantity": 1}]), 5499)

    def test_larger_order_gets_free_delivery(self):
        self.assertEqual(calculate_total(
            [{"price_cents": 3000, "quantity": 2}]), 5400)


if __name__ == "__main__":
    unittest.main()
