import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function shouldRunMatrix(
  eventName,
  event,
  findOpenPullRequests,
  findPullRequestRuns,
) {
  if (eventName !== "push" || event.ref === "refs/heads/main") return true;
  const branch = event.ref?.replace(/^refs\/heads\//u, "");
  const repository = event.repository?.full_name;
  const owner = event.repository?.owner?.login;
  if (!branch || !repository || !owner || !event.after) return true;
  try {
    const pulls = findOpenPullRequests(repository, `${owner}:${branch}`);
    // Only this exact revision may delegate its checks to a PR. API errors,
    // stale PR metadata and malformed responses keep the full push matrix.
    const matchingPull =
      Array.isArray(pulls) &&
      pulls.find(
        (pull) =>
          pull.state === "open" &&
          pull.head?.sha === event.after &&
          pull.head?.ref === branch &&
          pull.head?.repo?.full_name === repository,
      );
    if (!matchingPull) return true;
    // Conflicted PRs do not receive pull_request runs. A queued or completed
    // validation must actually exist; a race conservatively duplicates work.
    const runs = findPullRequestRuns(repository, event.after);
    return (
      !Array.isArray(runs) ||
      !runs.some(
        (run) =>
          run.event === "pull_request" &&
          run.head_sha === event.after &&
          (["queued", "in_progress"].includes(run.status) ||
            (run.status === "completed" &&
              ["success", "failure", "timed_out"].includes(run.conclusion))),
      )
    );
  } catch {
    console.warn("Unable to establish PR ownership; running full push CI.");
    return true;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const request = (path, filters) => {
    const result = spawnSync(
      "gh",
      [
        "api",
        "--method",
        "GET",
        path,
        ...filters.flatMap((filter) => ["-f", filter]),
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error("CI ownership lookup failed");
    return JSON.parse(result.stdout);
  };
  const runMatrix = shouldRunMatrix(
    process.env.GITHUB_EVENT_NAME,
    event,
    (repository, head) =>
      request(`repos/${repository}/pulls`, [
        "state=open",
        `head=${head}`,
        "per_page=100",
      ]),
    (repository, sha) =>
      request(`repos/${repository}/actions/workflows/cross-platform.yml/runs`, [
        "event=pull_request",
        `head_sha=${sha}`,
        "per_page=100",
      ]).workflow_runs,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `run-matrix=${runMatrix}\n`);
  console.log(
    runMatrix
      ? "Run complete CI matrix."
      : "Open PR owns validation of this revision; skip duplicate push matrix.",
  );
}
