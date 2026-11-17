import unittest

from scheduler import run_jobs


class SchedulerTests(unittest.TestCase):
    def test_parallel_jobs_then_dependency_join(self):
        jobs = [
            {"id": "a", "duration": 2},
            {"id": "b", "duration": 4},
            {"id": "c", "duration": 1, "depends_on": ["a", "b"]},
        ]
        self.assertEqual(run_jobs(jobs), [
            (0, "a", "started"), (0, "b", "started"),
            (2, "a", "succeeded"), (4, "b", "succeeded"),
            (4, "c", "started"), (5, "c", "succeeded"),
        ])

    def test_retry_releases_worker_but_does_not_release_dependants(self):
        jobs = [
            {"id": "a", "duration": 1, "failures": 1, "retries": 1},
            {"id": "b", "duration": 1, "depends_on": ["a"]},
            {"id": "c", "duration": 3},
        ]
        self.assertEqual(run_jobs(jobs, workers=1), [
            (0, "a", "started"), (1, "a", "retry_wait"),
            (1, "c", "started"), (4, "c", "succeeded"),
            (4, "a", "started"), (5, "a", "succeeded"),
            (5, "b", "started"), (6, "b", "succeeded"),
        ])

    def test_repeated_failures_double_delay_from_attempt_completion(self):
        jobs = [{"id": "a", "duration": 1, "failures": 2, "retries": 2}]
        self.assertEqual(run_jobs(jobs, retry_delay=2), [
            (0, "a", "started"), (1, "a", "retry_wait"),
            (3, "a", "started"), (4, "a", "retry_wait"),
            (8, "a", "started"), (9, "a", "succeeded"),
        ])

    def test_exhausted_retries_block_transitive_dependants(self):
        jobs = [
            {"id": "z", "duration": 1, "failures": 3, "retries": 1},
            {"id": "b", "duration": 1, "depends_on": ["z"]},
            {"id": "a", "duration": 1, "depends_on": ["b"]},
            {"id": "other", "duration": 6},
        ]
        self.assertEqual(run_jobs(jobs), [
            (0, "other", "started"), (0, "z", "started"),
            (1, "z", "retry_wait"), (3, "z", "started"),
            (4, "z", "failed"), (4, "b", "blocked"),
            (4, "a", "blocked"), (6, "other", "succeeded"),
        ])

    def test_simultaneous_completions_are_handled_before_new_starts(self):
        jobs = [
            {"id": "b", "duration": 2},
            {"id": "a", "duration": 2},
            {"id": "c", "duration": 1, "depends_on": ["a", "b"]},
        ]
        self.assertEqual(run_jobs(jobs), [
            (0, "a", "started"), (0, "b", "started"),
            (2, "a", "succeeded"), (2, "b", "succeeded"),
            (2, "c", "started"), (3, "c", "succeeded"),
        ])

    def test_ready_jobs_compete_by_name_including_a_due_retry(self):
        jobs = [
            {"id": "a", "duration": 3},
            {"id": "b", "duration": 1, "depends_on": ["a"]},
            {"id": "z", "duration": 1, "failures": 1, "retries": 1},
        ]
        self.assertEqual(run_jobs(jobs, retry_delay=2), [
            (0, "a", "started"), (0, "z", "started"),
            (1, "z", "retry_wait"), (3, "a", "succeeded"),
            (3, "b", "started"), (3, "z", "started"),
            (4, "b", "succeeded"), (4, "z", "succeeded"),
        ])

    def test_zero_delay_still_waits_for_attempt_completion(self):
        jobs = [{"id": "a", "duration": 1, "failures": 1, "retries": 1}]
        self.assertEqual(run_jobs(jobs, retry_delay=0), [
            (0, "a", "started"), (1, "a", "retry_wait"),
            (1, "a", "started"), (2, "a", "succeeded"),
        ])

    def test_no_retries_means_one_attempt(self):
        self.assertEqual(run_jobs([{"id": "a", "duration": 1, "failures": 1}]),
                         [(0, "a", "started"), (1, "a", "failed")])

    def test_empty_input_and_repeated_runs(self):
        self.assertEqual(run_jobs([]), [])
        jobs = [{"id": "a", "duration": 1, "failures": 1, "retries": 1}]
        original = [dict(job) for job in jobs]
        self.assertEqual(run_jobs(jobs), run_jobs(jobs))
        self.assertEqual(jobs, original)

    def test_invalid_configuration_and_dependency_cycle(self):
        with self.assertRaises(ValueError):
            run_jobs([], workers=0)
        with self.assertRaises(ValueError):
            run_jobs([], retry_delay=-1)
        with self.assertRaises(ValueError):
            run_jobs([{"id": "a", "duration": 1, "depends_on": ["a"]}])


if __name__ == "__main__":
    unittest.main()
