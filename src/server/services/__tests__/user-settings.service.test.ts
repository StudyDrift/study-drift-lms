import { UpdateUserSettingsPayload } from "@/models/user-settings.model"
import { describe, expect, test, vi } from "vitest"
import { getUserSettings, updateUserSettings } from "../user-settings.service"

vi.mock("../database.service", () => {
  return {
    getCollection: vi.fn().mockReturnValue({
      updateOne: vi.fn(),
      findOne: vi
        .fn()
        .mockReturnValue(Promise.resolve({ colorScheme: "dark" })),
    }),
  }
})

describe("user settings service", () => {
  describe("updateUserSettings", () => {
    test("update user settings", async () => {
      const payload: UpdateUserSettingsPayload = { colorScheme: "dark" }

      expect(async () => {
        await updateUserSettings("testUserId", payload)
      }).not.toThrow()
    })
  })

  describe("getUserSettings", () => {
    test("get user settings", async () => {
      const settings = await getUserSettings("testUserId")

      expect(settings?.colorScheme).toEqual("dark")
    })
  })
})
