export const TOOLS = ["get_graph", "read_shader", "write_shader", "set_param", "add_node", "connect", "disconnect", "edit_node", "view"] as const;
export type ToolName = (typeof TOOLS)[number];

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };

export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export type ClientFrame =
  | { type: "start"; room: string; goal: string; graph: string; token?: string }
  | { type: "user"; text: string; graph: string }
  | { type: "result"; id: string; content: Content[]; isError?: boolean }
  | { type: "stop" };

export type ServerFrame =
  | { type: "ready"; model: string }
  | { type: "tool_call"; id: string; name: ToolName; input: Record<string, unknown> }
  | { type: "text"; text: string }
  | { type: "done"; cost: number; turns: number; isError?: boolean; message?: string }
  | { type: "error"; message: string };
