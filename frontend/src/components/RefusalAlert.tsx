import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** A refused or failed backend call, as text only (the message may carry names from the project). Retry is optional. */
export function RefusalAlert({ title, error, onRetry }: { title: string; error: ApiError; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon /> Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
