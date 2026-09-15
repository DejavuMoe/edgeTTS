import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  secondaryLabel?: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options?: readonly SelectOption[] | undefined;
  groups?: readonly SelectGroup[] | undefined;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface DropdownPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function Select({
  id: explicitId,
  value,
  onChange,
  options,
  groups,
  placeholder = "请选择...",
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps) {
  const generatedId = useId();
  const triggerId = explicitId || generatedId;
  const listboxId = `${triggerId}-listbox`;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition>({
    left: 0,
    width: 240,
    maxHeight: 320,
  });
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Flatten all selectable options for indexing and navigation
  const flatOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [];
    if (options) {
      list.push(...options);
    }
    if (groups) {
      for (const group of groups) {
        list.push(...group.options);
      }
    }
    return list;
  }, [options, groups]);

  // Find active option
  const activeOption = useMemo(() => {
    return flatOptions.find((opt) => opt.value === value);
  }, [flatOptions, value]);

  // Update fixed portal position relative to trigger and viewport boundaries
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const width = Math.max(rect.width, 240);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;

    if (placeAbove) {
      setDropdownPos({
        bottom: viewportHeight - rect.top + 4,
        left,
        width: Math.min(width, viewportWidth - 16),
        maxHeight: Math.min(320, spaceAbove - 16),
      });
    } else {
      setDropdownPos({
        top: rect.bottom + 4,
        left,
        width: Math.min(width, viewportWidth - 16),
        maxHeight: Math.min(320, spaceBelow - 16),
      });
    }
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
    const currentIndex = flatOptions.findIndex((opt) => opt.value === value);
    setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [disabled, updatePosition, flatOptions, value]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (option: SelectOption) => {
      if (option.disabled) return;
      onChange(option.value);
      closeDropdown();
    },
    [onChange, closeDropdown],
  );

  // Reposition or close on window events
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener("resize", handleResize, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isOpen, updatePosition]);

  // Scroll focused option into view
  useEffect(() => {
    if (!isOpen || focusedIndex < 0 || !menuRef.current) return;
    const optionElements = menuRef.current.querySelectorAll<HTMLElement>("[role='option']");
    const targetElement = optionElements[focusedIndex];
    if (targetElement && typeof targetElement.scrollIntoView === "function") {
      targetElement.scrollIntoView({ block: "nearest" });
    }
  }, [isOpen, focusedIndex]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      return;
    }

    if (e.key === "Tab") {
      setIsOpen(false);
      return;
    }

    if (flatOptions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        let next = prev + 1;
        while (next < flatOptions.length && flatOptions[next]?.disabled) {
          next++;
        }
        return next < flatOptions.length ? next : prev;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => {
        let prevIdx = prev - 1;
        while (prevIdx >= 0 && flatOptions[prevIdx]?.disabled) {
          prevIdx--;
        }
        return prevIdx >= 0 ? prevIdx : prev;
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      let first = 0;
      while (first < flatOptions.length && flatOptions[first]?.disabled) {
        first++;
      }
      if (first < flatOptions.length) setFocusedIndex(first);
    } else if (e.key === "End") {
      e.preventDefault();
      let last = flatOptions.length - 1;
      while (last >= 0 && flatOptions[last]?.disabled) {
        last--;
      }
      if (last >= 0) setFocusedIndex(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < flatOptions.length) {
        const option = flatOptions[focusedIndex];
        if (option && !option.disabled) {
          handleSelect(option);
        }
      }
    }
  };

  const displayLabel = activeOption ? activeOption.label : placeholder;

  return (
    <div className={`ui-select-container ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`control-select ui-select-trigger ${isOpen ? "is-open" : ""}`}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        onKeyDown={handleKeyDown}
        aria-activedescendant={
          isOpen && focusedIndex >= 0 && flatOptions[focusedIndex]
            ? `${listboxId}-opt-${flatOptions[focusedIndex].value || focusedIndex}`
            : undefined
        }
        value={value}
        data-value={value}
      >
        <span className="ui-select-trigger-label">{displayLabel}</span>
        <svg
          className={`ui-select-chevron ${isOpen ? "is-open" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            className="ui-select-menu"
            tabIndex={-1}
            style={{
              position: "fixed",
              top: dropdownPos.top !== undefined ? `${dropdownPos.top}px` : undefined,
              bottom: dropdownPos.bottom !== undefined ? `${dropdownPos.bottom}px` : undefined,
              left: `${dropdownPos.left}px`,
              width: `${dropdownPos.width}px`,
              maxHeight: `${dropdownPos.maxHeight}px`,
              zIndex: 9999,
            }}
            aria-label={ariaLabel || "Options"}
            aria-activedescendant={
              focusedIndex >= 0 && flatOptions[focusedIndex]
                ? `${listboxId}-opt-${flatOptions[focusedIndex].value || focusedIndex}`
                : undefined
            }
            onKeyDown={handleKeyDown}
          >
            {/* Top-level standalone options */}
            {options &&
              options.map((opt, optIndex) => {
                const isSelected = opt.value === value;
                const isFocused = flatOptions.indexOf(opt) === focusedIndex;
                return (
                  <div
                    key={opt.value || `opt-${optIndex}`}
                    id={`${listboxId}-opt-${opt.value || optIndex}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    data-value={opt.value}
                    className={`ui-select-option ${isSelected ? "is-selected" : ""} ${
                      isFocused ? "is-focused" : ""
                    } ${opt.disabled ? "is-disabled" : ""}`}
                    onClick={() => handleSelect(opt)}
                    onMouseEnter={() => {
                      if (!opt.disabled) {
                        setFocusedIndex(flatOptions.indexOf(opt));
                      }
                    }}
                  >
                    <div className="ui-select-option-content">
                      <span className="ui-select-option-main">{opt.label}</span>
                      {opt.secondaryLabel && (
                        <span className="ui-select-option-sub">{opt.secondaryLabel}</span>
                      )}
                    </div>
                    {isSelected && (
                      <svg
                        className="ui-select-check"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
                      </svg>
                    )}
                  </div>
                );
              })}

            {/* Grouped options */}
            {groups &&
              groups.map((group) => (
                <div
                  key={group.label}
                  className="ui-select-group"
                  role="group"
                  aria-label={group.label}
                >
                  <div className="ui-select-group-header" role="presentation">
                    {group.label}
                  </div>
                  {group.options.map((opt, optIndex) => {
                    const isSelected = opt.value === value;
                    const isFocused = flatOptions.indexOf(opt) === focusedIndex;
                    return (
                      <div
                        key={opt.value || `grp-opt-${optIndex}`}
                        id={`${listboxId}-opt-${opt.value || optIndex}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={opt.disabled}
                        data-value={opt.value}
                        className={`ui-select-option ${isSelected ? "is-selected" : ""} ${
                          isFocused ? "is-focused" : ""
                        } ${opt.disabled ? "is-disabled" : ""}`}
                        onClick={() => handleSelect(opt)}
                        onMouseEnter={() => {
                          if (!opt.disabled) {
                            setFocusedIndex(flatOptions.indexOf(opt));
                          }
                        }}
                      >
                        <div className="ui-select-option-content">
                          <span className="ui-select-option-main">{opt.label}</span>
                          {opt.secondaryLabel && (
                            <span className="ui-select-option-sub">{opt.secondaryLabel}</span>
                          )}
                        </div>
                        {isSelected && (
                          <svg
                            className="ui-select-check"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="3.5 8.5 6.5 11.5 12.5 5" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
