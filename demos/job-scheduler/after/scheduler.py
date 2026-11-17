import heapq


def run_jobs(jobs, workers=2, retry_delay=2):
    """Simulate jobs and return (time, job_id, event) entries.

    Jobs have unique string ids, positive integer durations, and optional
    depends_on (existing ids), failures (failures before success), and retries
    (extra attempts). Counts are nonnegative integers. Dependencies must form
    an acyclic graph. Times are simulated: no real work or sleeping occurs.
    """
    if workers < 1 or retry_delay < 0:
        raise ValueError("Need at least one worker and a nonnegative delay")

    definitions = {job["id"]: job for job in jobs}
    pending = set(definitions)
    state = {name: "pending" for name in definitions}
    attempts = {name: 0 for name in definitions}
    ready_at = {name: 0 for name in definitions}
    running = []
    events = []
    now = 0

    while pending or running:
        while running and running[0][0] <= now:
            finished_at, name = heapq.heappop(running)
            job = definitions[name]
            if attempts[name] <= job.get("failures", 0):
                if attempts[name] <= job.get("retries", 0):
                    state[name] = "pending"
                    ready_at[name] = finished_at + retry_delay * 2 ** (attempts[name] - 1)
                    pending.add(name)
                    event = "retry_wait"
                else:
                    state[name] = "failed"
                    event = "failed"
            else:
                state[name] = "succeeded"
                event = "succeeded"
            events.append((finished_at, name, event))

        changed = True
        while changed:
            changed = False
            for name in sorted(pending):
                dependencies = definitions[name].get("depends_on", [])
                if any(state[dependency] in ("failed", "blocked")
                       for dependency in dependencies):
                    pending.remove(name)
                    state[name] = "blocked"
                    events.append((now, name, "blocked"))
                    changed = True

        for name in sorted(pending):
            if len(running) >= workers:
                break
            dependencies = definitions[name].get("depends_on", [])
            if ready_at[name] > now or not all(
                    state[dependency] == "succeeded" for dependency in dependencies):
                continue
            pending.remove(name)
            state[name] = "running"
            attempts[name] += 1
            heapq.heappush(running, (now + definitions[name]["duration"], name))
            events.append((now, name, "started"))

        next_times = [running[0][0]] if running else []
        if len(running) < workers:
            next_times.extend(
                ready_at[name] for name in pending
                if ready_at[name] > now and all(
                    state[dependency] == "succeeded"
                    for dependency in definitions[name].get("depends_on", []))
            )
        if next_times:
            now = min(next_times)
        elif pending:
            raise ValueError("Dependencies cannot make progress")

    return events


if __name__ == "__main__":
    jobs = [
        {"id": "fetch", "duration": 2, "failures": 1, "retries": 1},
        {"id": "index", "duration": 1, "depends_on": ["fetch"]},
        {"id": "report", "duration": 4},
        {"id": "notify", "duration": 1, "depends_on": ["index", "report"]},
    ]
    for event in run_jobs(jobs):
        print(event)
