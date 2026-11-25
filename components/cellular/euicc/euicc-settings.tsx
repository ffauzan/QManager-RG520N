"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import ConditionScreen from "@/components/cellular/condition-screen";
import CellularPageHeader from "@/components/cellular/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";
import { useEuicc, type EuiccAction } from "@/hooks/use-euicc";
import type { EuiccProfile } from "@/lib/euicc";
import { staggerContainer, staggerItem } from "@/lib/motion";

import {
  CARD_FOOTNOTE,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  PAGE_ROOT,
  ROW_GROUP,
  SETTING_ROW,
} from "../settings/shapes";

const K = "core_settings.euicc";

const STATE_SPEC: Record<
  EuiccProfile["state"],
  { variant: "success" | "muted" | "warning"; glyph: MaterialSymbolName }
> = {
  enabled: { variant: "success", glyph: "check_circle" },
  disabled: { variant: "muted", glyph: "block" },
  unknown: { variant: "warning", glyph: "help" },
};

const EuiccSettings = () => {
  const { t } = useTranslation("cellular");
  const euicc = useEuicc();

  const [pending, setPending] = React.useState<{
    action: Extract<EuiccAction, "enable" | "delete">;
    profile: EuiccProfile;
  } | null>(null);

  const confirm = async () => {
    if (!pending) return;

    const { action, profile } = pending;
    setPending(null);

    const result = await euicc.runAction(action, profile);
    if (result.ok) {
      toast.success(
        action === "enable" ? t(`${K}.toast.enabled`) : t(`${K}.toast.deleted`),
      );
      return;
    }

    toast.error(
      t(
        result.error === "refresh_timeout"
          ? `${K}.errors.refresh_timeout`
          : result.error === "state_not_changed"
            ? `${K}.errors.state_not_changed`
            : `${K}.errors.action_failed`,
      ),
      { description: result.detail },
    );
  };

  const profiles = euicc.data?.profiles ?? [];

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          <Button
            type="button"
            variant="tonal-neutral"
            size="sm"
            onClick={() => void euicc.refresh()}
            disabled={euicc.isLoading || euicc.isMutating}
          >
            <MaterialSymbol name="refresh" size={16} />
            {t(`${K}.card.refresh`)}
          </Button>
        }
      />

      <motion.div
        className="flex flex-col gap-4"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <Card className={CARD_SHELL}>
            <CardHeader className={CARD_PAD}>
              <CardTitle className={CARD_TITLE}>
                {t(`${K}.card.title`)}
              </CardTitle>
              <CardDescription>{t(`${K}.card.description`)}</CardDescription>

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-tile bg-surface-container px-4 py-3">
                <span className="text-on-surface-variant text-[0.78125rem] font-semibold tracking-wide uppercase">
                  {t(`${K}.card.eid`)}
                </span>
                <code className="min-w-0 font-mono text-[0.78125rem] break-all">
                  {euicc.data?.eid || "—"}
                </code>
              </div>
            </CardHeader>

            <CardContent className={CARD_PAD}>
              {euicc.isLoading ? (
                <ConditionScreen
                  tone="primary"
                  glyph="progress_activity"
                  spin
                  ariaRole="status"
                  title={t(`${K}.states.loading_title`)}
                  description={t(`${K}.states.loading_description`)}
                />
              ) : euicc.error ? (
                <ConditionScreen
                  tone="destructive"
                  glyph="error"
                  ariaRole="alert"
                  title={t(`${K}.errors.load_title`)}
                  description={t(`${K}.errors.load_description`)}
                  onRetry={() => void euicc.refresh()}
                  retryLabel={t(`${K}.errors.retry`)}
                />
              ) : profiles.length === 0 ? (
                <ConditionScreen
                  tone="neutral"
                  glyph="sim_card"
                  ariaRole="status"
                  title={t(`${K}.states.empty_title`)}
                  description={t(`${K}.states.empty_description`)}
                />
              ) : (
                <div className={ROW_GROUP.ROOT}>
                  {profiles.map((profile, index) => {
                    const state = STATE_SPEC[profile.state];
                    const isPending = euicc.isMutating;

                    return (
                      <React.Fragment key={profile.iccidHex || profile.iccid}>
                        {index > 0 ? (
                          <div className={ROW_GROUP.DIVIDER} aria-hidden="true" />
                        ) : null}

                        <div className={SETTING_ROW.ROOT}>
                          <div className={SETTING_ROW.TEXT}>
                            <div className={SETTING_ROW.LABEL_ROW}>
                              <span className={SETTING_ROW.LABEL}>
                                {profile.name}
                              </span>
                              <Badge variant={state.variant}>
                                <MaterialSymbol
                                  name={state.glyph}
                                  size={12}
                                />
                                {t(`${K}.states.${profile.state}`)}
                              </Badge>
                            </div>
                            <span className={SETTING_ROW.CONSEQUENCE}>
                              {profile.spn
                                ? t(`${K}.card.profile_meta`, {
                                    spn: profile.spn,
                                    iccid: profile.iccid,
                                  })
                                : profile.iccid}
                            </span>
                          </div>

                          <div className={`${SETTING_ROW.CONTROL} gap-2`}>
                            {profile.state === "disabled" ? (
                              <>
                                <Button
                                  type="button"
                                  variant="tonal"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() =>
                                    setPending({ action: "enable", profile })
                                  }
                                >
                                  {t(`${K}.actions.enable`)}
                                </Button>
                                <Button
                                  type="button"
                                  variant="tonal-destructive"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() =>
                                    setPending({ action: "delete", profile })
                                  }
                                >
                                  {t(`${K}.actions.delete`)}
                                </Button>
                              </>
                            ) : (
                              <span className="text-on-surface-variant text-xs">
                                {isPending
                                  ? t(`${K}.actions.working`)
                                  : t(`${K}.actions.no_action`)}
                              </span>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}

              {euicc.isMutating ? (
                <p className="text-on-surface-variant mt-4 text-sm" role="status">
                  {t(`${K}.toast.refreshing`)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={staggerItem} className={CARD_FOOTNOTE.ROOT}>
          <span aria-hidden="true" className={CARD_FOOTNOTE.DISC}>
            <MaterialSymbol name="info" filled size={CARD_FOOTNOTE.GLYPH} />
          </span>
          <p className={CARD_FOOTNOTE.BODY}>{t(`${K}.page.note`)}</p>
        </motion.div>
      </motion.div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending
                ? t(
                    pending.action === "enable"
                      ? `${K}.confirm.enable_title`
                      : `${K}.confirm.delete_title`,
                    { name: pending.profile.name },
                  )
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? t(
                    pending.action === "enable"
                      ? `${K}.confirm.enable_description`
                      : `${K}.confirm.delete_description`,
                    { name: pending.profile.name },
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.actions.cancel`)}</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.action === "delete" ? "destructive" : "default"}
              onClick={() => void confirm()}
            >
              {pending
                ? t(
                    pending.action === "enable"
                      ? `${K}.confirm.confirm_enable`
                      : `${K}.confirm.confirm_delete`,
                  )
                : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EuiccSettings;
