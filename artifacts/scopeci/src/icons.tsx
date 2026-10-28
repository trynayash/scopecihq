import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';

/**
 * The site's icons: Hugeicons' open-source stroke set (MIT,
 * github.com/hugeicons/hugeicons), re-exported under the plain names the
 * pages use. Every page imports from here, so the set stays small and one
 * swap changes it everywhere. The GitHub mark is not an icon; it comes from
 * VendorMark in site.tsx.
 */
export {
  Add01Icon as PlusIcon,
  Alert02Icon as AlertIcon,
  ArrowDown01Icon as ChevronDownIcon,
  ArrowDown02Icon as ArrowDownIcon,
  ArrowLeft02Icon as ArrowLeftIcon,
  ArrowRight02Icon as ArrowRightIcon,
  ArrowUpRight01Icon as ExternalIcon,
  Cancel01Icon as CrossIcon,
  ComputerIcon as SystemThemeIcon,
  ContractsIcon as ContractIcon,
  Copy01Icon as CopyIcon,
  Download01Icon as DownloadIcon,
  File02Icon as DocumentIcon,
  Folder01Icon as FolderIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  Invoice01Icon as InvoiceIcon,
  Link04Icon as LinkIcon,
  Logout01Icon as SignOutIcon,
  Menu01Icon as MenuIcon,
  MinusSignIcon as NeutralIcon,
  Moon02Icon as MoonIcon,
  ReloadIcon,
  SquareLock01Icon as LockIcon,
  Sun03Icon as SunIcon,
  Tick02Icon as TickIcon,
  UserMultipleIcon as TeamIcon,
} from '@hugeicons/core-free-icons';

export type { IconSvgElement };

/**
 * One icon, sized to the text beside it. Icons here are always decorative:
 * the button or link around them carries the words, so they are hidden from
 * assistive technology.
 */
export function Icon({
  icon,
  size = 16,
  strokeWidth = 1.8,
  className,
}: {
  icon: IconSvgElement;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      focusable="false"
    />
  );
}
