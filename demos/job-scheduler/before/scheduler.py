def run_jobs(jobs):
    """Simulate independent jobs running one at a time.

    Each job has a unique string id and a positive integer duration.
    Return (time, job_id, event) entries; no real work or sleeping occurs.
    """
    now = 0
    events = []
    for job in jobs:
        events.append((now, job["id"], "started"))
        now += job["duration"]
        events.append((now, job["id"], "succeeded"))
    return events
