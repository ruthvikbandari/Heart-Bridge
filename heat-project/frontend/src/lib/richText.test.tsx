import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RichText } from "./richText"

describe("RichText", () => {
  it("renders emphasis and links without executing markup", () => {
    render(<RichText text={'Hello <script>alert(1)</script> and **bold**\n- one\nSee https://www.who.int/health-topics'} />)
    expect(document.querySelector("script")).toBeNull()
    expect(screen.getByText(/alert\(1\)/)).toBeTruthy()
    expect(screen.getByText("bold").tagName).toBe("STRONG")
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://www.who.int/health-topics")
  })
})
