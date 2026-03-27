import { forwardRef, type ForwardRefExoticComponent, type Ref, type RefAttributes } from "react"
import { HugeiconsIcon, type HugeiconsProps, type IconSvgElement } from "@hugeicons/react"
import {
  Archive01Icon,
  Archive03Icon,
  ArrowDown01Icon,
  ArrowDownLeft01Icon,
  ArrowLeft01Icon,
  ArrowMoveDownLeftIcon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  BashIcon,
  Attachment01Icon,
  BookOpen02Icon,
  BrainIcon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  CodeIcon,
  CodeSquareIcon,
  CommandLineIcon,
  Compass01Icon,
  ComputerTerminal02Icon,
  CssFile01Icon,
  Csv01Icon,
  DashedLineCircleIcon,
  Delete02Icon,
  Doc01Icon,
  DocumentValidationIcon,
  Edit02Icon,
  EyeIcon,
  File01Icon,
  FileAudioIcon,
  FileLockedIcon,
  FileScriptIcon,
  FileVideoIcon,
  FileZipIcon,
  Folder01Icon,
  Folder02Icon,
  Folder03Icon,
  FolderAddIcon,
  GitBranchIcon,
  GitCompareIcon,
  GitPullRequestIcon,
  Globe02Icon,
  HtmlFile01Icon,
  Idea01Icon,
  Image01Icon,
  JavaScriptIcon,
  Jpg01Icon,
  Loading03Icon,
  MachineRobotIcon,
  Mic01Icon,
  MinusSignSquareIcon,
  Pdf01Icon,
  PencilEdit02Icon,
  PinIcon,
  Png01Icon,
  PlusSignIcon,
  PlusSignSquareIcon,
  Ppt01Icon,
  PythonIcon,
  ReactIcon,
  RefreshIcon,
  Search01Icon,
  Settings02Icon,
  SidebarLeftIcon,
  SourceCodeSquareIcon,
  SqlIcon,
  StopIcon,
  Svg01Icon,
  TextIcon,
  Typescript01Icon,
  ViewIcon,
  Xls01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"

export type IconProps = Omit<HugeiconsProps, "icon"> & {
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | (string & {})
}

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

function createIcon(name: string, icon: IconSvgElement): Icon {
  const Component = forwardRef(function IconComponent(
    { weight: _weight, strokeWidth = 1.8, ...props }: IconProps,
    ref: Ref<SVGSVGElement>,
  ) {
    return <HugeiconsIcon ref={ref} icon={icon} strokeWidth={strokeWidth} {...props} />
  })

  Component.displayName = name
  return Component
}

export const InformationCircle = forwardRef(function InformationCircleIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v5" />
      <path d="M12 7.5h.01" />
    </svg>
  )
}) as Icon
InformationCircle.displayName = "InformationCircle"

export const Copy = forwardRef(function CopyIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="9" y="7" width="11" height="13" rx="2.5" />
      <path d="M15 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" />
    </svg>
  )
}) as Icon
Copy.displayName = "Copy"

export const DotsThree = forwardRef(function DotsThreeIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  const radius = strokeWidth >= 2 ? 1.75 : 1.5

  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="6" cy="12" r={radius} fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r={radius} fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r={radius} fill="currentColor" stroke="none" />
    </svg>
  )
}) as Icon
DotsThree.displayName = "DotsThree"

export const CloudUpload = forwardRef(function CloudUploadIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7.5 18.25h8.75a4.25 4.25 0 0 0 .62-8.45 5.75 5.75 0 0 0-11.21 1.44A3.75 3.75 0 0 0 7.5 18.25Z" />
      <path d="M12 15.25v-5.5" />
      <path d="m9.75 12 2.25-2.25L14.25 12" />
    </svg>
  )
}) as Icon
CloudUpload.displayName = "CloudUpload"

export const Play = forwardRef(function PlayIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M8 6.75c0-1.17 1.268-1.894 2.271-1.298l7.045 4.182c.972.577.972 1.982 0 2.559l-7.045 4.182C9.268 16.97 8 16.247 8 15.077V6.75Z" />
    </svg>
  )
}) as Icon
Play.displayName = "Play"

export const GitCommit = forwardRef(function GitCommitIcon(
  { size = 24, strokeWidth = 1.8, ...props }: IconProps,
  ref: Ref<SVGSVGElement>
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 12h4" />
      <path d="M16 12h4" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  )
}) as Icon
GitCommit.displayName = "GitCommit"

export const Archive = createIcon("Archive", Archive03Icon)
export const ArrowDown = createIcon("ArrowDown", ArrowDown01Icon)
export const ArrowElbowDownLeft = createIcon("ArrowElbowDownLeft", ArrowDownLeft01Icon)
export const ArrowUp = createIcon("ArrowUp", ArrowUp01Icon)
export const ArrowUp02 = createIcon("ArrowUp02", ArrowUp02Icon)
export const ArrowMoveDownLeft = createIcon("ArrowMoveDownLeft", ArrowMoveDownLeftIcon)
export const BracketsCurly = createIcon("BracketsCurly", CodeSquareIcon)
export const BookOpen = createIcon("BookOpen", BookOpen02Icon)
export const Brain = createIcon("Brain", BrainIcon)
export const CaretDown = createIcon("CaretDown", ArrowDown01Icon)
export const CaretLeft = createIcon("CaretLeft", ArrowLeft01Icon)
export const CaretRight = createIcon("CaretRight", ArrowRight01Icon)
export const CaretUp = createIcon("CaretUp", ArrowUp01Icon)
export const ChatCircle = createIcon("ChatCircle", BubbleChatIcon)
export const CheckCircle = createIcon("CheckCircle", CheckmarkCircle02Icon)
export const ChevronDownIcon = createIcon("ChevronDownIcon", ArrowDown01Icon)
export const Circle = createIcon("Circle", CircleIcon)
export const CircleDashed = createIcon("CircleDashed", DashedLineCircleIcon)
export const Clock = createIcon("Clock", Clock01Icon)
export const CircleNotch = createIcon("CircleNotch", Loading03Icon)
export const Command = createIcon("Command", CommandLineIcon)
export const Compass = createIcon("Compass", Compass01Icon)
export const Commit = GitCommit
export const Cloud = CloudUpload
export const Eye = createIcon("Eye", EyeIcon)
export const File = createIcon("File", File01Icon)
export const FileAudio = createIcon("FileAudio", FileAudioIcon)
export const FileC = createIcon("FileC", CodeIcon)
export const FileCSharp = createIcon("FileCSharp", CodeIcon)
export const FileCode = createIcon("FileCode", FileScriptIcon)
export const FileCpp = createIcon("FileCpp", CodeIcon)
export const FileCss = createIcon("FileCss", CssFile01Icon)
export const FileCsv = createIcon("FileCsv", Csv01Icon)
export const FileDoc = createIcon("FileDoc", Doc01Icon)
export const DocumentValidation = createIcon("DocumentValidation", DocumentValidationIcon)
export const FileHtml = createIcon("FileHtml", HtmlFile01Icon)
export const FileImage = createIcon("FileImage", Image01Icon)
export const FileJpg = createIcon("FileJpg", Jpg01Icon)
export const FileJs = createIcon("FileJs", JavaScriptIcon)
export const FileJsx = createIcon("FileJsx", ReactIcon)
export const FileLock = createIcon("FileLock", FileLockedIcon)
export const FileMd = createIcon("FileMd", TextIcon)
export const FilePdf = createIcon("FilePdf", Pdf01Icon)
export const FilePng = createIcon("FilePng", Png01Icon)
export const FilePpt = createIcon("FilePpt", Ppt01Icon)
export const FilePy = createIcon("FilePy", PythonIcon)
export const FileRs = createIcon("FileRs", SourceCodeSquareIcon)
export const FileSql = createIcon("FileSql", SqlIcon)
export const FileSvg = createIcon("FileSvg", Svg01Icon)
export const FileText = createIcon("FileText", TextIcon)
export const FileTs = createIcon("FileTs", Typescript01Icon)
export const FileTsx = createIcon("FileTsx", ReactIcon)
export const FileVideo = createIcon("FileVideo", FileVideoIcon)
export const FileVue = createIcon("FileVue", CodeIcon)
export const FileXls = createIcon("FileXls", Xls01Icon)
export const FileZip = createIcon("FileZip", FileZipIcon)
export const Folder = createIcon("Folder", Folder01Icon)
export const FolderOpen = createIcon("FolderOpen", Folder03Icon)
export const FolderSimple = createIcon("FolderSimple", Folder02Icon)
export const FolderSimplePlus = createIcon("FolderSimplePlus", FolderAddIcon)
export const GearSix = createIcon("GearSix", Settings02Icon)
export const GitBranch = createIcon("GitBranch", GitBranchIcon)
export const GitDiff = createIcon("GitDiff", GitCompareIcon)
export const GitPullRequest = createIcon("GitPullRequest", GitPullRequestIcon)
export const Globe = createIcon("Globe", Globe02Icon)
export const Image = createIcon("Image", Image01Icon)
export const Lightbulb = createIcon("Lightbulb", Idea01Icon)
export const MagnifyingGlass = createIcon("MagnifyingGlass", Search01Icon)
export const Microphone = createIcon("Microphone", Mic01Icon)
export const Paperclip = createIcon("Paperclip", Attachment01Icon)
export const PencilSimple = createIcon("PencilSimple", Edit02Icon)
export const Plus = createIcon("Plus", PlusSignIcon)
export const PlusSquare = createIcon("PlusSquare", PlusSignSquareIcon)
export const PushPin = createIcon("PushPin", PinIcon)
export const Refresh = createIcon("Refresh", RefreshIcon)
export const Robot = createIcon("Robot", MachineRobotIcon)
export const Sidebar = createIcon("Sidebar", SidebarLeftIcon)
export const Square = createIcon("Square", StopIcon)
export const SquareMinus = createIcon("SquareMinus", MinusSignSquareIcon)
export const SquarePlus = createIcon("SquarePlus", PlusSignSquareIcon)
export const Stop = createIcon("Stop", StopIcon)
export const Bash = createIcon("Bash", BashIcon)
export const Terminal = createIcon("Terminal", ComputerTerminal02Icon)
export const Trash = createIcon("Trash", Delete02Icon)
export const X = createIcon("X", Cancel01Icon)
export const Zap = createIcon("Zap", ZapIcon)
