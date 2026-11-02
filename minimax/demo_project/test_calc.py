import unittest

from calc import add, divide


class TestCalc(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_divide_ok(self):
        self.assertEqual(divide(6, 3), 2)

    def test_divide_by_zero(self):
        # 目标行为：除数为 0 时抛 ValueError，且信息为 divisor must be non-zero
        with self.assertRaises(ValueError) as ctx:
            divide(1, 0)
        self.assertEqual(str(ctx.exception), "divisor must be non-zero")


if __name__ == "__main__":
    unittest.main()
