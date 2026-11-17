import * as React from 'react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

// The dropdown-menu.tsx surface and item styles over Radix ContextMenu (right-click, and long-press on touch).
const menuSurface =
  'z-50 min-w-[10rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';
const itemBase =
  "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

const ContextMenu = (props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
const ContextMenuTrigger = (props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) => <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content data-slot="context-menu-content" className={cn(menuSurface, 'max-h-(--radix-context-menu-content-available-height) overflow-y-auto', className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({ className, variant = 'default', ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(itemBase, 'data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:*:[svg]:!text-destructive', className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator };
