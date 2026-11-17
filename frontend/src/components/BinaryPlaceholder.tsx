import { FileIcon } from 'lucide-react';

export function BinaryPlaceholder({ size }: { size: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <FileIcon className="size-8" />
      <p>Binary file, {size} bytes</p>
      <p className="text-xs">Binary files are not shown or edited.</p>
    </div>
  );
}
