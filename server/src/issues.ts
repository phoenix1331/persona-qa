import type { Session } from './sessions.js';
import type { Issue } from './writer.js';

export interface IssueInput {
  title: string;
  severity: Issue['severity'];
  what_happened: string;
  expected: string;
}

export async function recordIssue(session: Session, input: IssueInput): Promise<Issue> {
  const number = session.issues.length + 1;
  const pageOpen = !session.page.isClosed();
  const screenshot = pageOpen
    ? await session.writer.screenshot(session, `issue-${number}`)
    : undefined;

  const issue: Issue = {
    id: `${session.persona.id}-${session.mission.id}-${number}`,
    step: session.steps,
    severity: input.severity,
    title: input.title.trim(),
    what_happened: input.what_happened.trim(),
    expected: input.expected.trim(),
    url: pageOpen ? session.page.url() : '',
    ...(screenshot === undefined ? {} : { screenshot }),
    recorded_at: new Date().toISOString(),
  };

  session.issues.push(issue);
  session.writer.log(session, `issue ${issue.id} ${issue.severity}: ${issue.title}`);
  return issue;
}
