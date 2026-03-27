'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ItemInstance } from '@headless-tree/core';
import { ChevronDownIcon, SquareMinus, SquarePlus } from '@/components/icons';
import { Slot as SlotPrimitive } from 'radix-ui';

type ToggleIconType = 'chevron' | 'plus-minus';

interface TreeInstance {
  getContainerProps?: () => Record<string, unknown>;
  getDragLineStyle?: () => React.CSSProperties;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TreeContextValue<T = any> {
  indent: number;
  currentItem?: ItemInstance<T>;
  tree?: TreeInstance;
  toggleIconType?: ToggleIconType;
}

const TreeContext = React.createContext<TreeContextValue>({
  indent: 20,
  currentItem: undefined,
  tree: undefined,
  toggleIconType: 'plus-minus',
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useTreeContext<T = any>() {
  return React.useContext(TreeContext) as TreeContextValue<T>;
}

interface TreeProps extends React.HTMLAttributes<HTMLDivElement> {
  indent?: number;
  tree?: TreeInstance;
  toggleIconType?: ToggleIconType;
}

function Tree({ indent = 20, tree, className, toggleIconType = 'chevron', ...props }: TreeProps) {
  const containerProps = tree && typeof tree.getContainerProps === 'function' ? tree.getContainerProps() : {};
  const mergedProps = { ...props, ...containerProps };

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps;

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    '--tree-indent': `${indent}px`,
  } as React.CSSProperties;

  return (
    <TreeContext.Provider value={{ indent, tree, toggleIconType }}>
      <div
        data-slot="tree"
        style={mergedStyle}
        className={cn('flex flex-col font-sans text-sm', className)}
        {...otherProps}
      />
    </TreeContext.Provider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TreeItemProps<T = any> extends React.HTMLAttributes<HTMLButtonElement> {
  item: ItemInstance<T>;
  indent?: number;
  asChild?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TreeItem<T = any>({ item, className, asChild, children, ...props }: Omit<TreeItemProps<T>, 'indent'>) {
  const parentContext = useTreeContext<T>();
  const { indent } = parentContext;

  const itemProps = typeof item.getProps === 'function' ? item.getProps() : {};
  const mergedProps = { ...props, ...itemProps };

  // Extract style from mergedProps to merge with our custom styles
  const { style: propStyle, ...otherProps } = mergedProps;

  // Merge styles
  const mergedStyle = {
    ...propStyle,
    '--tree-padding': `${item.getItemMeta().level * indent}px`,
  } as React.CSSProperties;

  const Comp = asChild ? SlotPrimitive.Slot : 'button';

  return (
    <TreeContext.Provider value={{ ...parentContext, currentItem: item }}>
      <Comp
        data-slot="tree-item"
        style={mergedStyle}
        className={cn(
          'z-10 w-full text-left ps-(--tree-padding) outline-hidden select-none not-last:pb-0.5 focus:z-20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className,
        )}
        data-focus={typeof item.isFocused === 'function' ? item.isFocused() || false : undefined}
        data-folder={typeof item.isFolder === 'function' ? item.isFolder() || false : undefined}
        data-selected={typeof item.isSelected === 'function' ? item.isSelected() || false : undefined}
        data-drag-target={typeof item.isDragTarget === 'function' ? item.isDragTarget() || false : undefined}
        data-search-match={typeof item.isMatchingSearch === 'function' ? item.isMatchingSearch() || false : undefined}
        aria-expanded={item.isExpanded()}
        {...otherProps}
      >
        {children}
      </Comp>
    </TreeContext.Provider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface TreeItemLabelProps<T = any> extends React.HTMLAttributes<HTMLSpanElement> {
  item?: ItemInstance<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TreeItemLabel<T = any>({ item: propItem, children, className, ...props }: TreeItemLabelProps<T>) {
  const { currentItem, toggleIconType } = useTreeContext<T>();
  const item = propItem || currentItem;

  if (!item) {
    console.warn('TreeItemLabel: No item provided via props or context');
    return null;
  }

  return (
    <span
      data-slot="tree-item-label"
      className={cn(
        'in-focus-visible:ring-ring/50 hover:bg-sidebar-accent/50 in-data-[selected=true]:bg-sidebar-accent in-data-[selected=true]:text-sidebar-accent-foreground in-data-[drag-target=true]:bg-sidebar-accent flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm px-2 py-1.5 text-sm not-in-data-[folder=true]:ps-7 in-focus-visible:ring-[3px] in-data-[search-match=true]:bg-blue-50! [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {item.isFolder() &&
        (toggleIconType === 'plus-minus' ? (
          item.isExpanded() ? (
            <SquareMinus className="text-muted-foreground size-3.5" stroke="currentColor" strokeWidth={1} />
          ) : (
            <SquarePlus className="text-muted-foreground size-3.5" stroke="currentColor" strokeWidth={1} />
          )
        ) : (
          <ChevronDownIcon className="text-muted-foreground size-4 in-aria-[expanded=false]:-rotate-90" />
        ))}
      {children || (typeof item.getItemName === 'function' ? item.getItemName() : null)}
    </span>
  );
}

function TreeDragLine({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { tree } = useTreeContext();

  if (!tree || typeof tree.getDragLineStyle !== 'function') {
    console.warn('TreeDragLine: No tree provided via context or tree does not have getDragLineStyle method');
    return null;
  }

  const dragLine = tree.getDragLineStyle();
  return (
    <div
      style={dragLine}
      className={cn(
        'bg-primary before:bg-background before:border-primary absolute z-30 -mt-px h-0.5 w-[unset] before:absolute before:-top-[3px] before:left-0 before:size-2 before:rounded-full before:border-2',
        className,
      )}
      {...props}
    />
  );
}

export { Tree, TreeItem, TreeItemLabel, TreeDragLine };
