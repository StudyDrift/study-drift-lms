import { Term } from "@/models/term.model"
import { describe, expect, test, vi } from "vitest"
import { createTerm, getByDateRange, getById, getByIds } from "../term.service"

vi.mock("../database.service", () => {
  return {
    getCollection: vi.fn().mockReturnValue({
      insertOne: vi.fn().mockReturnValue(
        Promise.resolve({
          dates: {},
          id: "test-id",
          name: "test-term",
          meta: {},
        })
      ),
      findOne: vi.fn().mockReturnValue(
        Promise.resolve({
          dates: {},
          id: "test-id",
          name: "test-term",
          meta: {},
        })
      ),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockReturnValue(
          Promise.resolve([
            {
              dates: {},
              id: "test-id",
              name: "test-term",
              meta: {},
            },
          ])
        ),
      }),
    }),
  }
})

describe("term service", () => {
  describe("createTerm", () => {
    test("should create a new term", async () => {
      const term: Term = {
        dates: {},
        id: "test-id",
        name: "test-term",
        meta: {},
      }

      const result = await createTerm(term)

      expect(result.name).toEqual("test-term")
    })
  })

  describe("getById", () => {
    test("should get a term by id", async () => {
      const term = await getById("test-id")

      expect(term).not.toBeUndefined()
      expect(term?.id).toEqual("test-id")
    })
  })

  describe("getByIds", () => {
    test("should get terms by multiple ids", async () => {
      const terms = await getByIds(["test-id"])

      expect(terms).not.toBeUndefined()
      expect(terms.length).toEqual(1)
      expect(terms[0]?.id).toEqual("test-id")
    })
  })

  describe("getByDateRange", () => {
    test("should get terms within the date range", async () => {
      const terms = await getByDateRange("2024-09-01", "2024-12-15")

      expect(terms).not.toBeUndefined()
      expect(terms.length).toEqual(1)
      expect(terms[0]?.id).toEqual("test-id")
    })
  })
})
