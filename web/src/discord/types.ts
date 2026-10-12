/**
 * Discord-shaped data as the shim sends it over `/app/ws`. Only the fields the play UI reads are typed;
 * everything is optional where Discord itself treats it as optional.
 */

export type Snowflake = string;

export type User = {
  id: Snowflake;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  roles?: Snowflake[];
};

export type Role = {
  id: Snowflake;
  name: string;
  color?: number;
  position?: number;
  managed?: boolean;
};

export const ChannelType = {
  Text: 0,
  DM: 1,
  Category: 4,
  Announcement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  Forum: 15,
} as const;

export type Channel = {
  id: Snowflake;
  type: number;
  name: string;
  parent_id?: Snowflake | null;
  position?: number;
  topic?: string | null;
  last_message_id?: Snowflake | null;
  thread_metadata?: { archived?: boolean; locked?: boolean };
  thread_members?: Snowflake[];
  permission_overwrites?: { id: Snowflake | number; type: number; allow?: string | number; deny?: string | number }[];
};

export type PartialEmoji = {
  id?: Snowflake | null;
  name?: string | null;
  animated?: boolean;
};

export type Attachment = {
  id: Snowflake;
  filename: string;
  size?: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
  width?: number | null;
  height?: number | null;
  description?: string;
};

export type EmbedMedia = { url: string; width?: number; height?: number; proxy_url?: string };

export type Embed = {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: EmbedMedia;
  thumbnail?: EmbedMedia;
  author?: { name: string; url?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
};

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  Container: 17,
  Label: 18,
} as const;

export type SelectOption = {
  label: string;
  value: string;
  description?: string;
  emoji?: PartialEmoji | null;
  default?: boolean;
};

export type UnfurledMedia = { url: string; width?: number; height?: number; content_type?: string };

/** One loose component shape covering every type; `type` discriminates which fields are meaningful. */
export type Component = {
  type: number;
  id?: number;
  custom_id?: string;
  components?: Component[];
  // button
  style?: number;
  label?: string;
  emoji?: PartialEmoji | null;
  url?: string;
  disabled?: boolean;
  // select
  placeholder?: string;
  options?: SelectOption[];
  min_values?: number;
  max_values?: number;
  channel_types?: number[];
  default_values?: { id: Snowflake; type: "user" | "role" | "channel" }[];
  // text input
  value?: string;
  min_length?: number;
  max_length?: number;
  required?: boolean;
  // v2
  content?: string;
  accessory?: Component;
  media?: UnfurledMedia;
  description?: string | null;
  spoiler?: boolean;
  items?: { media: UnfurledMedia; description?: string | null; spoiler?: boolean }[];
  file?: UnfurledMedia;
  divider?: boolean;
  spacing?: number;
  accent_color?: number | null;
  // label (18)
  component?: Component;
};

export type Message = {
  id: Snowflake;
  channel_id: Snowflake;
  author: User;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  attachments?: Attachment[];
  embeds?: Embed[];
  components?: Component[];
  flags?: number;
  type?: number;
  pinned?: boolean;
  mentions?: User[];
  mention_roles?: Snowflake[];
  mention_everyone?: boolean;
  message_reference?: { message_id?: Snowflake; channel_id?: Snowflake };
  referenced_message?: Message | null;
  interaction_metadata?: { id: Snowflake; type: number; user?: User };
  ephemeral?: boolean;
  /** Shim extension: the player whose button press this bot post answers. */
  prompted_user_id?: Snowflake;
  /** Shim extension: my latest press on this message (any device): when, and the controls it had then. */
  my_press?: { at: string; controls: string };
};

export const MessageFlags = {
  Ephemeral: 64,
  Loading: 128,
  ComponentsV2: 32768,
} as const;

export type CommandOptionChoice = { name: string; value: string | number };

export const OptionType = {
  SubCommand: 1,
  SubCommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
} as const;

export type CommandOption = {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  choices?: CommandOptionChoice[];
  options?: CommandOption[];
  autocomplete?: boolean;
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  channel_types?: number[];
};

export type Command = {
  id: Snowflake;
  name: string;
  type?: number;
  description?: string;
  options?: CommandOption[];
};

/** Option values as sent in an interaction (`command` / `autocomplete` ops). */
export type InteractionOption = {
  type: number;
  name: string;
  value?: string | number | boolean;
  options?: InteractionOption[];
  focused?: boolean;
};

export type Modal = {
  custom_id: string;
  title: string;
  components: Component[];
};

export type ServerFrame =
  | {
      t: "hello";
      me: User;
      bot_id: Snowflake;
      guild_id: Snowflake;
      users: User[];
      roles: Role[];
      channels: Channel[];
      commands: Command[];
      bot_online: boolean;
    }
  | { t: "history"; channel_id: Snowflake; messages: Message[]; has_more: boolean; nonce?: string }
  | { t: "message_create"; message: Message }
  | { t: "message_update"; message: Message }
  | { t: "message_delete"; channel_id: Snowflake; id: Snowflake }
  | { t: "channel_upsert"; channel: Channel }
  | { t: "channel_delete"; id: Snowflake }
  | { t: "channels"; channels: Channel[] }
  | { t: "user_upsert"; user: User }
  | { t: "modal"; interaction_id: Snowflake; nonce?: string; modal: Modal }
  | { t: "interaction_done"; nonce?: string; error?: string }
  | { t: "autocomplete"; nonce?: string; choices: CommandOptionChoice[] }
  | { t: "error"; nonce?: string; error: string }
  | { t: "pong"; nonce?: string }
  /** The bot became usable (connected and its slash commands registered) or went away. */
  | { t: "bot_status"; bot_online: boolean; commands?: Command[] };

/** Submitted modal component, in Discord's MODAL_SUBMIT shape. `id` is the component's numeric id (JDA requires it). */
export type ModalSubmitComponent =
  | { type: 1; id: number; components: { type: 4; id: number; custom_id: string; value: string }[] }
  | {
      type: 18;
      id: number;
      component:
        | { type: 4; id: number; custom_id: string; value: string }
        | { type: number; id: number; custom_id: string; values: string[] };
    };

export type ClientOp =
  | { op: "history"; channel_id: Snowflake; before?: Snowflake; limit?: number }
  | { op: "click"; channel_id: Snowflake; message_id: Snowflake; custom_id: string }
  | {
      op: "select";
      channel_id: Snowflake;
      message_id: Snowflake;
      custom_id: string;
      values: string[];
      component_type?: number;
    }
  | { op: "modal_submit"; interaction_id: Snowflake; custom_id: string; components: ModalSubmitComponent[] }
  | { op: "send"; channel_id: Snowflake; content: string; reply_to?: Snowflake }
  | { op: "command"; channel_id: Snowflake; name: string; options: InteractionOption[] }
  | { op: "autocomplete"; channel_id: Snowflake; name: string; options: InteractionOption[] }
  | { op: "dismiss"; channel_id: Snowflake; message_id: Snowflake }
  | { op: "ping" };
