import type { Repository } from "../types"

export const mockRepositories: Repository[] = [
  {
    id: "1",
    name: "conductor-playground",
    path: "/Users/bradleygibson/conductor/repos/conductor-playground",
    collapsed: false,
    workspaces: [
      {
        id: "1-1",
        branchName: "bradleygibsongit/opencode-chat-ui",
        name: "port-louis",
        lastActive: new Date(Date.now() - 26 * 60 * 1000), // 26m ago
        diffCount: 8804,
        isLoading: true,
      },
    ],
  },
  {
    id: "2",
    name: "test1234",
    path: "/Users/bradleygibson/conductor/repos/test1234",
    collapsed: false,
    workspaces: [
      {
        id: "2-1",
        branchName: "bradleygibsongit/alexandria",
        name: "alexandria",
        lastActive: new Date(Date.now() - 1 * 60 * 1000), // 1m ago
      },
      {
        id: "2-2",
        branchName: "bradleygibsongit/columbus",
        name: "columbus",
        lastActive: new Date(Date.now() - 1 * 60 * 1000), // 1m ago
        isLoading: true,
      },
      {
        id: "2-3",
        branchName: "bradleygibsongit/nicosia",
        name: "nicosia",
        lastActive: new Date(Date.now() - 1 * 60 * 1000), // 1m ago
        needsAttention: true,
      },
    ],
  },
  {
    id: "3",
    name: "test4567",
    path: "/Users/bradleygibson/conductor/repos/test4567",
    collapsed: false,
    workspaces: [
      {
        id: "3-1",
        branchName: "bradleygibsongit/barcelona",
        name: "barcelona",
        lastActive: new Date(), // just now
      },
    ],
  },
]
