import datetime
import subprocess

# Write today's date to a file
with open("activity.log", "a") as f:
    f.write(f"Activity logged at {datetime.datetime.now()}\n")

# Save it to GitHub
subprocess.run(["git", "add", "activity.log"])
subprocess.run(["git", "commit", "-m", f"Daily activity: {datetime.date.today()}"])
subprocess.run(["git", "push"])
