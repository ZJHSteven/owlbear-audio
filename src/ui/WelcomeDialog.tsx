import { HeadphonesIcon, InfoIcon, LibraryIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WelcomeDialogProps {
  open: boolean;
  onAcknowledge: () => void;
}

/**
 * DM 第一次进入时展示的“产品说明 + Owlbear 存储边界”。
 *
 * 这里刻意不用一大段免责声明，而只告诉用户真正会影响操作的两件事：
 * 1) 浏览器负责本地转码，不会先把原始音频传给我们自己的服务器；
 * 2) Owlbear 的公开 Asset API 必须经过宿主原生选择器，而且 uploadImages() 不返回
 *    新资产 URL，所以当前版本还需要一次“分享回扩展”的原生确认。
 */
export function WelcomeDialog({ open, onAcknowledge }: WelcomeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      // 首次公告必须明确点击“我已知晓”才持久化；按 Esc/关闭不算看完。
      if (!nextOpen) return;
    }}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HeadphonesIcon />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <DialogTitle>欢迎使用 Owlbear Audio</DialogTitle>
                <Badge variant="secondary">v0.1</Badge>
              </div>
              <DialogDescription>
                一个放在 Owlbear Action 里的轻量同步音乐库。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Alert>
            <InfoIcon />
            <AlertTitle>音频在你的浏览器里转码</AlertTitle>
            <AlertDescription>
              MP3、WAV、M4A 等输入会先在本机转成 Opus/WebM，再交给 Owlbear 保存。
            </AlertDescription>
          </Alert>

          <Alert>
            <LibraryIcon />
            <AlertTitle>“Owlbear Audio” Collection 是推荐项，不是硬性要求</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>为了以后好找，建议你在 Owlbear Asset Manager 里手动建一个专用 Collection。</span>
              <span>
                公开 SDK 目前不能替扩展创建 Collection，也不会在上传后返回新资产 URL，所以保存后仍会有一次原生“选回刚上传音频”的确认。
              </span>
            </AlertDescription>
          </Alert>

          <p className="text-xs leading-relaxed text-muted-foreground">
            PLAYER 不需要管理音乐库；只要加入同一房间，就会跟随 DM 的当前播放状态，并保留自己的本机音量。
          </p>
        </div>

        <DialogFooter>
          <Button className="w-full sm:w-auto" onClick={onAcknowledge}>
            我已知晓，进入音乐库
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
