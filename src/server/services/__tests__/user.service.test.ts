import { User } from "@/models/user.model"
import { describe, expect, test, vi } from "vitest"
import {
  getUser,
  getUserByEmail,
  getUserRole,
  getUsersByIds,
  provisionUser,
  searchUsers,
  setUserRole,
  updateUser,
} from "../user.service"

vi.mock("../database.service", () => {
  return {
    getCollection: vi.fn().mockReturnValue({
      insertOne: vi.fn(),
      findOne: vi
        .fn()
        .mockReturnValue(Promise.resolve({ email: "test", role: "test" })),
      updateOne: vi.fn(),
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockReturnValue(
            Promise.resolve([{ id: "test", email: "test", role: "test" }])
          ),
      }),
    }),
  }
})

describe("user service", () => {
  describe("provision user", () => {
    test("insert user", async () => {
      const user: Pick<User, "first" | "last" | "email"> = {
        first: "test",
        last: "test",
        email: "test",
      }

      const result = await provisionUser(user)

      expect(result.email).toBe(user.email)
    })
  })

  describe("getUser", () => {
    test("get user", async () => {
      const user = await getUser("test")

      expect(user).not.toBeUndefined()
    })
  })

  describe("getUserRole", () => {
    test("get user role", async () => {
      const role = await getUserRole("test")

      expect(role?.role).toEqual("test")
    })
  })

  describe("setUserRole", () => {
    test("set user role", async () => {
      expect(async () => {
        await setUserRole("test", "test")
      }).not.toThrow()
    })
  })

  describe("getUserByEmail", () => {
    test("get user by email", async () => {
      const user = await getUserByEmail("test")

      expect(user?.email).toEqual("test")
    })
  })

  describe("searchUsers", () => {
    test("search users", async () => {
      const users = await searchUsers("test")

      expect(users).not.toBeUndefined()
    })
  })

  describe("updateUser", () => {
    test("update user", async () => {
      expect(async () => {
        await updateUser("test", { role: "test" })
      }).not.toThrow()
    })
  })

  describe("getUsersById", () => {
    test("get users by ids", async () => {
      const users = await getUsersByIds(["test"])

      expect(users.length).toEqual(1)
    })
  })
})
