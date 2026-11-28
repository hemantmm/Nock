import { Prisma } from "@prisma/client";
import { generateId } from "./crypto";
import { prisma } from "./db";
import { publish } from "./bus";
import type { AlertView } from "./types";

type AlertType = AlertView["type"];

export async function createAlert(input: {
  endpointId: string;
  eventId?: string;
  type: AlertType;
  title: string;
  message: string;
  dedupeKey?: string;
}): Promise<void> {
  try {
    await prisma.alert.create({
      data: {
        id: generateId("alt", 12),
        endpointId: input.endpointId,
        eventId: input.eventId,
        type: input.type,
        title: input.title,
        message: input.message,
        dedupeKey: input.dedupeKey,
      },
    });
    publish(input.endpointId, { type: "refresh" });
  } catch (error) {
    if (input.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

export async function listAlerts(endpointId: string): Promise<{ alerts: AlertView[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    prisma.alert.findMany({
      where: { endpointId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.alert.count({ where: { endpointId, readAt: null } }),
  ]);
  return {
    alerts: rows.map((alert) => ({
      id: alert.id,
      eventId: alert.eventId,
      type: alert.type as AlertType,
      title: alert.title,
      message: alert.message,
      readAt: alert.readAt?.toISOString() ?? null,
      createdAt: alert.createdAt.toISOString(),
    })),
    unreadCount,
  };
}
