/**
 * One error panel for every screen that reads the API.
 * Roadmap: S4.3, S4.7
 *
 * A failed read always carries the way to try again. Silence would let "we could not look this up"
 * read as "there is nothing here".
 */

import { Button } from "./button";
import { Card } from "./card";

export function ErrorCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  const detail = error instanceof Error ? error.message : "The service did not answer.";

  return (
    <Card title={title}>
      <p className="text-sm text-ink-muted">{detail}</p>
      <div className="mt-3">
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Card>
  );
}
