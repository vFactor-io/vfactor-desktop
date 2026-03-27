/**
 * Types for the AgentActivity component.
 */

import type { TimestampedContent, ToolCallState } from "../../types";

/**
 * A unified item that can appear in the activity stream.
 * All items have a timestamp for chronological ordering.
 */
export type ActivityItem =
  | { type: "text"; data: TimestampedContent }
  | { type: "tool"; data: ToolCallState };

/**
 * Get the timestamp of an activity item for sorting.
 */
export function getActivityItemTimestamp(item: ActivityItem): number {
  switch (item.type) {
    case "text":
      return item.data.createdAt;
    case "tool":
      return item.data.createdAt;
  }
}

/**
 * Sort activity items by timestamp (oldest first).
 */
export function sortActivityItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort(
    (a, b) => getActivityItemTimestamp(a) - getActivityItemTimestamp(b)
  );
}
