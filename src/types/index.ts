export type AppEnvironment = 'development' | 'staging' | 'production';

export type UserRole = 'superadmin' | 'admin' | 'staff' | 'user' | 'auditor';
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';

export type FileFormat =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'csv'
  | 'png'
  | 'jpg'
  | 'webp'
  | 'txt'
  | 'html'
  | 'md';

export type MobileTab = 'home' | 'convert' | 'pdf' | 'docs' | 'profile';
export type MobileSubView =
  | 'none'
  | 'word_studio'
  | 'slides_studio'
  | 'sheets_studio'
  | 'studios_hub'
  | 'history'
  | 'notifications'
  | 'settings'
  | 'admin'
  | 'ai_assistant';

export interface AuthSessionMeta {
  userId: string;
  orgId: string;
  email: string;
  fullName: string;
  role: UserRole;
  planTier: PlanTier;
  issuedAt: number;
  expiresAt: number;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
  aiConsent?: boolean;
  marketingConsent?: boolean;
}

export interface BackendTokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  org_id: string;
  role: string;
  email: string;
  full_name?: string;
  plan_tier?: string;
}

export interface BackendRegisterPayload {
  email: string;
  password: string;
  full_name: string;
  organization_name?: string;
  terms_accepted: boolean;
  terms_version?: string;
  privacy_accepted: boolean;
  privacy_version?: string;
  ai_consent: boolean;
  ai_consent_version?: string;
  marketing_consent?: boolean;
}

export interface UserEntitlements {
  user_id: string;
  org_id: string;
  plan_slug: string;
  plan_name: string;
  is_active: boolean;
  is_suspended: boolean;
  enabled_features: string[];
  disabled_features: string[];
  storage_quota_bytes: number;
  processing_quota: number;
  ocr_quota: number;
  ai_quota: number;
  workflow_quota: number;
  max_file_size_bytes: number;
  has_api_access: boolean;
  support_level: string;
  overrides_applied?: Record<string, unknown>;
}

export interface UserUsageMetrics {
  storage_used_bytes: number;
  storage_quota_bytes: number;
  documents_count: number;
  jobs_count: number;
  recent_jobs: Array<{
    id: string;
    type: string;
    title: string;
    mode: string;
    status: string;
    created_at: string;
  }>;
}

export interface UserUiConfig {
  announcement_banner: string;
  maintenance_mode: boolean;
  maintenance_message: string;
  disabled_modules: string[];
  user_plan_module_enabled: boolean;
}

export interface BackendDocument {
  id: string;
  org_id: string;
  user_id: string | null;
  filename: string;
  file_size: number;
  mime_type: string;
  format_type: string;
  content_hash_sha256: string;
  version: number;
  created_at: string;
  updated_at?: string;
  digital_twin?: any;
}

export interface CloudProjectSummary {
  id: string;
  org_id: string;
  owner_user_id: string;
  workspace_id?: string | null;
  title: string;
  project_type: 'pdf' | 'docx' | 'slides' | 'sheets' | 'image' | 'ocr';
  version: number;
  size_bytes: number;
  content_hash_sha256: string;
  tags: string[];
  thumbnail?: string | null;
  is_deleted: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudProjectDetail extends CloudProjectSummary {
  data: any;
}

export interface AutonomousPlanNode {
  id: string;
  toolName: string;
  description: string;
  arguments: Record<string, any>;
  dependsOn: string[];
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'skipped';
  requiresApproval: boolean;
  result?: Record<string, any>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AutonomousExecutionPlan {
  planId: string;
  objective: string;
  nodes: AutonomousPlanNode[];
  estimatedDurationSeconds: number;
  isValidDag: boolean;
}

export interface BackendJob {
  id: string;
  org_id: string;
  user_id: string | null;
  title: string;
  objective: string;
  status: string;
  mode: string;
  plan?: AutonomousExecutionPlan | null;
  current_step_index: number;
  total_steps: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string;
  link_tab?: string | null;
  reference_id?: string | null;
  related_resource_type?: string | null;
  delivery_status: string;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread_count: number;
  page: number;
  limit: number;
}

export interface NotificationPreferences {
  in_app_admin: boolean;
  in_app_team: boolean;
  in_app_workflow: boolean;
  email_digest: boolean;
}

export interface LocalProcessingHistoryItem {
  id: string;
  kind: 'conversion' | 'pdf_operation' | 'sheet_export' | 'docx_export' | 'slides_export' | 'camera_scan' | 'upload';
  title: string;
  sourceFormat: string;
  targetFormat: string;
  sizeBytes: number;
  status: 'completed' | 'failed';
  createdAt: number;
  error?: string;
  documentId?: string;
}

export type JobStatus =
  | 'queued'
  | 'validating'
  | 'processing'
  | 'verifying'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface ConversionOptions {
  quality?: number;
  pageOrientation?: 'portrait' | 'landscape';
  includeStyles?: boolean;
  signal?: AbortSignal;
}

export interface ConversionJob {
  id: string;
  sourceFile: File;
  sourceFormat: FileFormat;
  targetFormat: FileFormat;
  status: JobStatus;
  progress: number;
  resultBlob?: Blob;
  resultFileName?: string;
  errorMessage?: string;
  options?: ConversionOptions;
  createdAt: number;
}

export interface PdfTextItem {
  id: string;
  str: string;
  pdfX: number;
  pdfY: number;
  viewportX: number;
  viewportY: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
}

export interface PdfTextEdit {
  id: string;
  pageIndex: number;
  originalText: string;
  newText: string;
  pdfX: number;
  pdfY: number;
  width: number;
  height: number;
  fontSize?: number;
  fontColor?: string;
  fontFamily?: 'Helvetica' | 'TimesRoman' | 'Courier';
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
  isRedaction?: boolean;
  isDeleted?: boolean;
}

export interface PDFAnnotation {
  id: string;
  pageIndex: number;
  type:
    | 'text'
    | 'watermark'
    | 'redact'
    | 'signature'
    | 'highlight'
    | 'underline'
    | 'strikethrough'
    | 'rectangle'
    | 'line'
    | 'comment'
    | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  opacity?: number;
  rotation?: number;
  dataUrl?: string;
}

export interface SlideElement {
  id: string;
  type: 'title' | 'text' | 'shape' | 'image' | 'badge';
  content?: string;
  shapeType?: 'rect' | 'circle' | 'pill' | 'callout';
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  src?: string;
}

export interface SlideItem {
  id: string;
  title: string;
  elements: SlideElement[];
  bgColor: string;
  layout: 'title' | 'content' | 'split' | 'blank';
}

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  grayscale: number;
  sepia: number;
  invert: number;
}

export interface ImageLayer {
  id: string;
  type: 'text' | 'shape' | 'sticker' | 'watermark';
  text?: string;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  stickerType?: string;
}
