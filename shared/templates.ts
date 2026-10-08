export type TemplateKind =
  | "booker_confirmation"
  | "host_confirmation"
  | "booker_reschedule"
  | "host_reschedule"
  | "booker_cancellation"
  | "host_cancellation"
  | "booker_reminder";

export interface EmailTemplate {
  enabled: boolean;
  subject: string;
  heading: string;
  /** Plain text with {{variables}}, **bold** and [links](https://...). */
  body: string;
  showDetails: boolean;
  buttonLabel: string;
}

export interface EmailStyle {
  useSiteColors: boolean;
  background: string;
  card: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  showLogo: boolean;
  radius: number;
  footer: string;
}

export type EmailTemplates = Record<TemplateKind, EmailTemplate>;

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  booker_confirmation: "Confirmation to the person booking",
  host_confirmation: "New booking notice to you",
  booker_reschedule: "Reschedule notice to the person booking",
  host_reschedule: "Reschedule notice to you",
  booker_cancellation: "Cancellation notice to the person booking",
  host_cancellation: "Cancellation notice to you",
  booker_reminder: "Reminder to the person booking",
};

export const TEMPLATE_VARIABLES: { name: string; description: string }[] = [
  { name: "booker_name", description: "Name of the person who booked" },
  { name: "booker_email", description: "Their email address" },
  { name: "business_name", description: "Your business name" },
  { name: "event_title", description: "Name of the meeting type" },
  { name: "date", description: "Date of the meeting" },
  { name: "time", description: "Start and end time" },
  { name: "timezone", description: "Timezone the time is shown in" },
  { name: "duration", description: "Length in minutes" },
  { name: "location", description: "Meeting link" },
  { name: "answers", description: "Answers to your form questions" },
  { name: "cancel_reason", description: "Reason given when cancelling" },
  { name: "manage_url", description: "Link to reschedule or cancel" },
];

export const DEFAULT_TEMPLATES: EmailTemplates = {
  booker_confirmation: {
    enabled: true,
    subject: "Confirmed: {{event_title}} on {{date}}",
    heading: "You're booked",
    body: "Hi {{booker_name}},\n\nYour {{event_title}} with {{business_name}} is confirmed. A calendar invite is attached.",
    showDetails: true,
    buttonLabel: "Reschedule or cancel",
  },
  host_confirmation: {
    enabled: true,
    subject: "New booking: {{event_title}} with {{booker_name}}",
    heading: "New booking",
    body: "**{{booker_name}}** ({{booker_email}}) booked {{event_title}}.\n\n{{answers}}",
    showDetails: true,
    buttonLabel: "Open booking",
  },
  booker_reschedule: {
    enabled: true,
    subject: "Rescheduled: {{event_title}} is now on {{date}}",
    heading: "Your booking was moved",
    body: "Hi {{booker_name}},\n\nYour {{event_title}} with {{business_name}} has a new time. An updated calendar invite is attached.",
    showDetails: true,
    buttonLabel: "Reschedule or cancel",
  },
  host_reschedule: {
    enabled: true,
    subject: "Rescheduled: {{event_title}} with {{booker_name}}",
    heading: "Booking rescheduled",
    body: "**{{booker_name}}** moved their {{event_title}} to a new time.",
    showDetails: true,
    buttonLabel: "Open booking",
  },
  booker_cancellation: {
    enabled: true,
    subject: "Cancelled: {{event_title}} on {{date}}",
    heading: "Booking cancelled",
    body: "Hi {{booker_name}},\n\nYour {{event_title}} with {{business_name}} has been cancelled.\n\n{{cancel_reason}}",
    showDetails: true,
    buttonLabel: "",
  },
  host_cancellation: {
    enabled: true,
    subject: "Cancelled: {{event_title}} with {{booker_name}}",
    heading: "Booking cancelled",
    body: "The {{event_title}} with **{{booker_name}}** was cancelled.\n\n{{cancel_reason}}",
    showDetails: true,
    buttonLabel: "",
  },
  booker_reminder: {
    enabled: true,
    subject: "Reminder: {{event_title}} at {{time}}",
    heading: "Coming up soon",
    body: "Hi {{booker_name}},\n\nThis is a reminder about your {{event_title}} with {{business_name}}.",
    showDetails: true,
    buttonLabel: "Reschedule or cancel",
  },
};

export const DEFAULT_EMAIL_STYLE: EmailStyle = {
  useSiteColors: true,
  background: "#f4f5f7",
  card: "#ffffff",
  text: "#14171f",
  muted: "#667085",
  primary: "#2f5bea",
  primaryText: "#ffffff",
  showLogo: true,
  radius: 12,
  footer: "Sent by {{business_name}}",
};
