import {
  Archive as PhosphorArchive,
  ArrowClockwise as PhosphorArrowClockwise,
  ArrowDown as PhosphorArrowDown,
  ArrowElbowDownLeft as PhosphorArrowElbowDownLeft,
  ArrowLineDownLeft as PhosphorArrowLineDownLeft,
  ArrowLeft as PhosphorArrowLeft,
  ArrowRight as PhosphorArrowRight,
  ArrowSquareOut as PhosphorArrowSquareOut,
  ArrowUp as PhosphorArrowUp,
  BookOpen as PhosphorBookOpen,
  BracketsCurly as PhosphorBracketsCurly,
  Brain as PhosphorBrain,
  CaretDown as PhosphorCaretDown,
  CaretLeft as PhosphorCaretLeft,
  CaretRight as PhosphorCaretRight,
  CaretUp as PhosphorCaretUp,
  CaretUpDown as PhosphorCaretUpDown,
  ChatCircle as PhosphorChatCircle,
  Check as PhosphorCheck,
  CheckCircle as PhosphorCheckCircle,
  Circle as PhosphorCircle,
  CircleDashed as PhosphorCircleDashed,
  CircleNotch as PhosphorCircleNotch,
  Clock as PhosphorClock,
  CloudArrowUp as PhosphorCloudArrowUp,
  Code as PhosphorCode,
  Command as PhosphorCommand,
  Compass as PhosphorCompass,
  Copy as PhosphorCopy,
  DotsThree as PhosphorDotsThree,
  Eye as PhosphorEye,
  File as PhosphorFile,
  FileAudio as PhosphorFileAudio,
  FileC as PhosphorFileC,
  FileCSharp as PhosphorFileCSharp,
  FileCode as PhosphorFileCode,
  FileCpp as PhosphorFileCpp,
  FileCss as PhosphorFileCss,
  FileCsv as PhosphorFileCsv,
  FileDoc as PhosphorFileDoc,
  FileHtml as PhosphorFileHtml,
  FileImage as PhosphorFileImage,
  FileJpg as PhosphorFileJpg,
  FileJs as PhosphorFileJs,
  FileJsx as PhosphorFileJsx,
  FileLock as PhosphorFileLock,
  FileMagnifyingGlass as PhosphorFileMagnifyingGlass,
  FileMd as PhosphorFileMd,
  FilePdf as PhosphorFilePdf,
  FilePng as PhosphorFilePng,
  FilePpt as PhosphorFilePpt,
  FilePy as PhosphorFilePy,
  FileRs as PhosphorFileRs,
  FileSql as PhosphorFileSql,
  FileSvg as PhosphorFileSvg,
  FileText as PhosphorFileText,
  FileTs as PhosphorFileTs,
  FileTsx as PhosphorFileTsx,
  FileVideo as PhosphorFileVideo,
  FileVue as PhosphorFileVue,
  FileXls as PhosphorFileXls,
  FileZip as PhosphorFileZip,
  Folder as PhosphorFolder,
  FolderOpen as PhosphorFolderOpen,
  FolderSimple as PhosphorFolderSimple,
  FolderSimplePlus as PhosphorFolderSimplePlus,
  GearSix as PhosphorGearSix,
  GitBranch as PhosphorGitBranch,
  GitCommit as PhosphorGitCommit,
  GitDiff as PhosphorGitDiff,
  GitPullRequest as PhosphorGitPullRequest,
  GithubLogo as PhosphorGithubLogo,
  Globe as PhosphorGlobe,
  Heart as PhosphorHeart,
  Image as PhosphorImage,
  Info as PhosphorInfo,
  Lightbulb as PhosphorLightbulb,
  Lightning as PhosphorLightning,
  MagnifyingGlass as PhosphorMagnifyingGlass,
  Microphone as PhosphorMicrophone,
  MinusSquare as PhosphorMinusSquare,
  Paperclip as PhosphorPaperclip,
  PencilSimple as PhosphorPencilSimple,
  Play as PhosphorPlay,
  Plus as PhosphorPlus,
  PlusSquare as PhosphorPlusSquare,
  PushPinSimple as PhosphorPushPinSimple,
  Robot as PhosphorRobot,
  ShieldWarning as PhosphorShieldWarning,
  SidebarSimple as PhosphorSidebarSimple,
  Square as PhosphorSquare,
  Terminal as PhosphorTerminal,
  TerminalWindow as PhosphorTerminalWindow,
  Trash as PhosphorTrash,
  X as PhosphorX,
  type Icon as PhosphorIcon,
  type IconProps as PhosphorIconProps,
  type IconWeight as PhosphorIconWeight,
} from "@phosphor-icons/react"
import { forwardRef, type ForwardRefExoticComponent, type Ref, type RefAttributes } from "react"

const PHOSPHOR_WEIGHTS = new Set<PhosphorIconWeight>([
  "thin",
  "light",
  "regular",
  "bold",
  "fill",
  "duotone",
])

export type IconProps = Omit<PhosphorIconProps, "weight"> & {
  weight?: PhosphorIconWeight | (string & {})
}

export type Icon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

function resolveWeight(weight: IconProps["weight"], strokeWidth?: string | number): PhosphorIconWeight {
  if (weight && PHOSPHOR_WEIGHTS.has(weight as PhosphorIconWeight)) {
    return weight as PhosphorIconWeight
  }

  const normalizedStrokeWidth =
    typeof strokeWidth === "number"
      ? strokeWidth
      : typeof strokeWidth === "string"
        ? Number.parseFloat(strokeWidth)
        : Number.NaN

  if (!Number.isFinite(normalizedStrokeWidth)) {
    return "regular"
  }

  if (normalizedStrokeWidth <= 1.25) {
    return "thin"
  }

  if (normalizedStrokeWidth <= 1.75) {
    return "light"
  }

  if (normalizedStrokeWidth <= 2.25) {
    return "regular"
  }

  return "bold"
}

function createIcon(name: string, Component: PhosphorIcon): Icon {
  const IconComponent = forwardRef(function IconComponent(
    { weight, strokeWidth, ...props }: IconProps,
    ref: Ref<SVGSVGElement>,
  ) {
    return <Component ref={ref} weight={resolveWeight(weight, strokeWidth)} {...props} />
  }) as Icon

  IconComponent.displayName = name
  return IconComponent
}

export const Archive = createIcon("Archive", PhosphorArchive)
export const ArrowDown = createIcon("ArrowDown", PhosphorArrowDown)
export const ArrowElbowDownLeft = createIcon("ArrowElbowDownLeft", PhosphorArrowElbowDownLeft)
export const ArrowUp = createIcon("ArrowUp", PhosphorArrowUp)
export const ArrowUp02 = createIcon("ArrowUp02", PhosphorArrowUp)
export const ArrowMoveDownLeft = createIcon("ArrowMoveDownLeft", PhosphorArrowLineDownLeft)
export const ArrowRight = createIcon("ArrowRight", PhosphorArrowRight)
export const ArrowSquareOut = createIcon("ArrowSquareOut", PhosphorArrowSquareOut)
export const BracketsCurly = createIcon("BracketsCurly", PhosphorBracketsCurly)
export const BookOpen = createIcon("BookOpen", PhosphorBookOpen)
export const Brain = createIcon("Brain", PhosphorBrain)
export const CaretDown = createIcon("CaretDown", PhosphorCaretDown)
export const CaretLeft = createIcon("CaretLeft", PhosphorCaretLeft)
export const CaretRight = createIcon("CaretRight", PhosphorCaretRight)
export const CaretUp = createIcon("CaretUp", PhosphorCaretUp)
export const CaretUpDown = createIcon("CaretUpDown", PhosphorCaretUpDown)
export const ChatCircle = createIcon("ChatCircle", PhosphorChatCircle)
export const Check = createIcon("Check", PhosphorCheck)
export const CheckCircle = createIcon("CheckCircle", PhosphorCheckCircle)
export const ChevronDownIcon = createIcon("ChevronDownIcon", PhosphorCaretDown)
export const Circle = createIcon("Circle", PhosphorCircle)
export const CircleDashed = createIcon("CircleDashed", PhosphorCircleDashed)
export const Clock = createIcon("Clock", PhosphorClock)
export const CircleNotch = createIcon("CircleNotch", PhosphorCircleNotch)
export const Command = createIcon("Command", PhosphorCommand)
export const Compass = createIcon("Compass", PhosphorCompass)
export const InformationCircle = createIcon("InformationCircle", PhosphorInfo)
export const Copy = createIcon("Copy", PhosphorCopy)
export const DotsThree = createIcon("DotsThree", PhosphorDotsThree)
export const CloudUpload = createIcon("CloudUpload", PhosphorCloudArrowUp)
export const Play = createIcon("Play", PhosphorPlay)
export const GitCommit = createIcon("GitCommit", PhosphorGitCommit)
export const Commit = GitCommit
export const Cloud = CloudUpload
export const Eye = createIcon("Eye", PhosphorEye)
export const File = createIcon("File", PhosphorFile)
export const FileAudio = createIcon("FileAudio", PhosphorFileAudio)
export const FileC = createIcon("FileC", PhosphorFileC)
export const FileCSharp = createIcon("FileCSharp", PhosphorFileCSharp)
export const FileCode = createIcon("FileCode", PhosphorFileCode)
export const FileCpp = createIcon("FileCpp", PhosphorFileCpp)
export const FileCss = createIcon("FileCss", PhosphorFileCss)
export const FileCsv = createIcon("FileCsv", PhosphorFileCsv)
export const FileDoc = createIcon("FileDoc", PhosphorFileDoc)
export const DocumentValidation = createIcon("DocumentValidation", PhosphorFileMagnifyingGlass)
export const FileHtml = createIcon("FileHtml", PhosphorFileHtml)
export const FileImage = createIcon("FileImage", PhosphorFileImage)
export const FileJpg = createIcon("FileJpg", PhosphorFileJpg)
export const FileJs = createIcon("FileJs", PhosphorFileJs)
export const FileJsx = createIcon("FileJsx", PhosphorFileJsx)
export const FileLock = createIcon("FileLock", PhosphorFileLock)
export const FileMd = createIcon("FileMd", PhosphorFileMd)
export const FilePdf = createIcon("FilePdf", PhosphorFilePdf)
export const FilePng = createIcon("FilePng", PhosphorFilePng)
export const FilePpt = createIcon("FilePpt", PhosphorFilePpt)
export const FilePy = createIcon("FilePy", PhosphorFilePy)
export const FileRs = createIcon("FileRs", PhosphorFileRs)
export const FileSql = createIcon("FileSql", PhosphorFileSql)
export const FileSvg = createIcon("FileSvg", PhosphorFileSvg)
export const FileText = createIcon("FileText", PhosphorFileText)
export const FileTs = createIcon("FileTs", PhosphorFileTs)
export const FileTsx = createIcon("FileTsx", PhosphorFileTsx)
export const FileVideo = createIcon("FileVideo", PhosphorFileVideo)
export const FileVue = createIcon("FileVue", PhosphorFileVue)
export const FileXls = createIcon("FileXls", PhosphorFileXls)
export const FileZip = createIcon("FileZip", PhosphorFileZip)
export const Folder = createIcon("Folder", PhosphorFolder)
export const FolderOpen = createIcon("FolderOpen", PhosphorFolderOpen)
export const FolderSimple = createIcon("FolderSimple", PhosphorFolderSimple)
export const FolderSimplePlus = createIcon("FolderSimplePlus", PhosphorFolderSimplePlus)
export const GearSix = createIcon("GearSix", PhosphorGearSix)
export const GitBranch = createIcon("GitBranch", PhosphorGitBranch)
export const GitDiff = createIcon("GitDiff", PhosphorGitDiff)
export const GitPullRequest = createIcon("GitPullRequest", PhosphorGitPullRequest)
export const GithubLogo = createIcon("GithubLogo", PhosphorGithubLogo)
export const Globe = createIcon("Globe", PhosphorGlobe)
export const Heart = createIcon("Heart", PhosphorHeart)
export const Image = createIcon("Image", PhosphorImage)
export const Lightbulb = createIcon("Lightbulb", PhosphorLightbulb)
export const MagnifyingGlass = createIcon("MagnifyingGlass", PhosphorMagnifyingGlass)
export const Microphone = createIcon("Microphone", PhosphorMicrophone)
export const Paperclip = createIcon("Paperclip", PhosphorPaperclip)
export const PencilSimple = createIcon("PencilSimple", PhosphorPencilSimple)
export const Plus = createIcon("Plus", PhosphorPlus)
export const PlusSquare = createIcon("PlusSquare", PhosphorPlusSquare)
export const PushPin = createIcon("PushPin", PhosphorPushPinSimple)
export const Refresh = createIcon("Refresh", PhosphorArrowClockwise)
export const Robot = createIcon("Robot", PhosphorRobot)
export const ShieldWarning = createIcon("ShieldWarning", PhosphorShieldWarning)
export const Sidebar = createIcon("Sidebar", PhosphorSidebarSimple)
export const Square = createIcon("Square", PhosphorSquare)
export const SquareMinus = createIcon("SquareMinus", PhosphorMinusSquare)
export const SquarePlus = createIcon("SquarePlus", PhosphorPlusSquare)
export const Stop = createIcon("Stop", PhosphorSquare)
export const Bash = createIcon("Bash", PhosphorTerminal)
export const Terminal = createIcon("Terminal", PhosphorTerminalWindow)
export const Trash = createIcon("Trash", PhosphorTrash)
export const X = createIcon("X", PhosphorX)
export const Zap = createIcon("Zap", PhosphorLightning)
