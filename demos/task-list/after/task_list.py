def find_tasks(tasks, search="", only_incomplete=False):
    """Find tasks by title, optionally keeping only incomplete tasks.

    Each task has a string title and a boolean completed value.
    The original tasks and their order are preserved.
    """
    search = search.strip().lower()
    matching_tasks = []

    for task in tasks:
        if only_incomplete and task["completed"]:
            continue

        if search not in task["title"].lower():
            continue

        matching_tasks.append(task)

    return matching_tasks


if __name__ == "__main__":
    tasks = [
        {"title": "Buy milk", "completed": False},
        {"title": "Buy bread", "completed": True},
        {"title": "Read a book", "completed": False},
    ]
    print(find_tasks(tasks, search=" BUY ", only_incomplete=True))
