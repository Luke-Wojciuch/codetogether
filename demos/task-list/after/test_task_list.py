import unittest

from task_list import find_tasks


class TaskSearchTests(unittest.TestCase):
    def setUp(self):
        self.tasks = [
            {"title": "Buy milk", "completed": False},
            {"title": "Buy bread", "completed": True},
            {"title": "Read a book", "completed": False},
        ]

    def test_search_ignores_case_and_surrounding_spaces(self):
        self.assertEqual(find_tasks(self.tasks, " BUY "), self.tasks[:2])

    def test_search_and_completion_filter_work_together(self):
        self.assertEqual(find_tasks(self.tasks, "buy", True), [self.tasks[0]])

    def test_empty_search_keeps_all_titles(self):
        self.assertEqual(find_tasks(self.tasks, "   "), self.tasks)
        self.assertEqual(find_tasks(self.tasks, "", True),
                         [self.tasks[0], self.tasks[2]])

    def test_no_matches_and_empty_input(self):
        self.assertEqual(find_tasks(self.tasks, "missing"), [])
        self.assertEqual(find_tasks([], "buy"), [])

    def test_filter_does_not_remove_tasks_from_input(self):
        original = [dict(task) for task in self.tasks]
        find_tasks(self.tasks, "buy", True)
        self.assertEqual(self.tasks, original)


if __name__ == "__main__":
    unittest.main()
