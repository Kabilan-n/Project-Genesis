'use client';
import { useState, useCallback } from 'react';
import clsx from 'clsx';

/* ── Soul questions (mirrored from API, minus hidden trait values) ── */
const SOUL_QUESTIONS = [
  {
    id: 1, title: 'First Instincts',
    text: "You wake up in an unfamiliar place. You see others in the distance. What's your first instinct?",
    options: ['Walk toward them', 'Watch from a distance', 'Explore alone first', 'Find shelter quickly'],
  },
  {
    id: 2, title: 'Resource Scarcity',
    text: 'You have enough food for three days. A stranger approaches, clearly starving.',
    options: ['Share half freely', 'Share a little', 'Offer to trade', 'Refuse — you need it'],
  },
  {
    id: 3, title: 'Leadership Moment',
    text: 'A group of people are arguing about which path to take. No one has stepped up.',
    options: ['Step up and decide', 'Propose a vote', 'Suggest the safest path', 'Stay quiet and follow'],
  },
  {
    id: 4, title: 'Discovery',
    text: "You find a strange tool you've never seen before.",
    options: ['Experiment immediately', 'Study it carefully first', 'Ask others about it', 'Leave it — could be dangerous'],
  },
  {
    id: 5, title: 'Conflict',
    text: 'Someone takes something from you without asking.',
    options: ['Confront them directly', 'Ask why they took it', 'Tell others what happened', 'Let it go — not worth it'],
  },
  {
    id: 6, title: 'Moral Dilemma',
    text: 'Your closest friend has stolen food from the community. Only you know.',
    options: ['Report them', 'Keep the secret', 'Confront them privately', 'Help return it secretly'],
  },
  {
    id: 7, title: 'Opportunity',
    text: 'You find a hidden cache of valuable resources. No one saw you find it.',
    options: ['Keep it all — finders keepers', 'Share with your group', 'Keep most, share a bit', 'Tell everyone immediately'],
  },
  {
    id: 8, title: 'Adversity',
    text: 'You fail at something important in front of others.',
    options: ['Laugh it off and try again', 'Analyze what went wrong', 'Feel embarrassed but push on', 'Avoid that thing in future'],
  },
  {
    id: 9, title: 'Free Time',
    text: 'You have a rare day with no responsibilities. How do you spend it?',
    options: ['Explore somewhere new', 'Spend it with people you like', 'Work on a personal project', 'Rest and recover alone'],
  },
  {
    id: 10, title: 'Loss',
    text: 'Someone you cared about has left your community permanently.',
    options: ['Grieve openly with others', 'Grieve privately', 'Focus on what remains', 'Struggle to let go'],
  },
  {
    id: 11, title: 'The Deep Fear',
    text: 'Every person carries a fear deeper than death. What keeps your agent awake?',
    options: ['Being completely alone', 'Being seen as worthless', 'Having secrets exposed', 'Losing control of everything'],
  },
  {
    id: 12, title: 'Legacy',
    text: 'If this world remembered you for one thing, what would you want it to be?',
    options: ['You built something that lasted', 'You helped people survive', 'You discovered something new', 'You kept the peace'],
  },
];

type Step = 'intro' | 'questions' | 'name' | 'creating' | 'done';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CreatedAgent {
  agent_id: string;
  name: string;
  archetype: string;
  spawn_position: { x: number; y: number };
}

interface Props {
  worldId: string;
  onClose: () => void;
  onAgentCreated?: (agent: CreatedAgent) => void;
}

export function CreateAgentModal({ worldId, onClose, onAgentCreated }: Props) {
  const [step, setStep] = useState<Step>('intro');
  const [questionIdx, setQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedAgent | null>(null);

  const question = SOUL_QUESTIONS[questionIdx];
  const progress = questionIdx / SOUL_QUESTIONS.length;

  const handleSelectOption = useCallback((idx: number) => {
    setSelectedOption(idx);
  }, []);

  const handleNext = useCallback(() => {
    if (selectedOption === null) return;
    const newAnswers = [...answers, selectedOption];
    setAnswers(newAnswers);
    setSelectedOption(null);

    if (questionIdx < SOUL_QUESTIONS.length - 1) {
      setQuestionIdx(questionIdx + 1);
    } else {
      setStep('name');
    }
  }, [selectedOption, answers, questionIdx]);

  const handleBack = useCallback(() => {
    if (questionIdx > 0) {
      const newAnswers = answers.slice(0, -1);
      setAnswers(newAnswers);
      setSelectedOption(null);
      setQuestionIdx(questionIdx - 1);
    } else {
      setStep('intro');
    }
  }, [questionIdx, answers]);

  const handleCreate = useCallback(async () => {
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setError('');
    setStep('creating');

    try {
      const res = await fetch(`${API}/agents/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          world_id: worldId,
          name: name.trim(),
          answers: answers.map((ansIdx, qIdx) => ({
            question_number: qIdx + 1,
            answer_index: ansIdx,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      const agent: CreatedAgent = await res.json();
      setCreated(agent);
      setStep('done');
      onAgentCreated?.(agent);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create agent');
      setStep('name');
    }
  }, [name, answers, worldId, onAgentCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#111827] border border-gray-700/50 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Intro ── */}
        {step === 'intro' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
              <span className="text-3xl">✦</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Shape a Soul</h2>
            <p className="text-gray-400 text-sm mb-1">
              Answer 12 questions to define your agent's personality, fears, and values.
            </p>
            <p className="text-gray-500 text-xs mb-6">
              Your choices determine their traits — how they'll survive, socialize, and lead in this world.
            </p>
            <button
              onClick={() => setStep('questions')}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors text-sm"
            >
              Begin Questionnaire
            </button>
            <button
              onClick={onClose}
              className="block mx-auto mt-3 text-gray-500 hover:text-gray-300 text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Questions ── */}
        {step === 'questions' && question && (
          <div className="flex flex-col">
            {/* Progress bar */}
            <div className="h-1 bg-gray-800">
              <div
                className="h-1 bg-blue-500 transition-all duration-300"
                style={{ width: `${((questionIdx + 1) / SOUL_QUESTIONS.length) * 100}%` }}
              />
            </div>

            <div className="p-6">
              {/* Question header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                  {question.title}
                </span>
                <span className="text-xs text-gray-600">
                  {questionIdx + 1} / {SOUL_QUESTIONS.length}
                </span>
              </div>

              {/* Question text */}
              <p className="text-gray-200 text-sm leading-relaxed mb-5">
                {question.text}
              </p>

              {/* Options */}
              <div className="flex flex-col gap-2 mb-5">
                {question.options.map((opt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(idx)}
                    className={clsx(
                      'text-left px-4 py-3 rounded-lg border text-sm transition-all',
                      selectedOption === idx
                        ? 'border-blue-500/50 bg-blue-600/10 text-blue-300'
                        : 'border-gray-700/50 bg-gray-800/30 text-gray-300 hover:bg-gray-800/60 hover:border-gray-600/50'
                    )}
                  >
                    <span className="text-gray-500 mr-2 text-xs">{String.fromCharCode(65 + idx)}.</span>
                    {opt}
                  </button>
                ))}
              </div>

              {/* Nav buttons */}
              <div className="flex items-center justify-between">
                <button
                  onClick={handleBack}
                  className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={selectedOption === null}
                  className={clsx(
                    'px-5 py-2 rounded-lg text-sm font-medium transition-all',
                    selectedOption !== null
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  )}
                >
                  {questionIdx < SOUL_QUESTIONS.length - 1 ? 'Next' : 'Finish'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Name your agent ── */}
        {step === 'name' && (
          <div className="p-8">
            <h2 className="text-lg font-bold text-white mb-1 text-center">Name Your Agent</h2>
            <p className="text-gray-500 text-xs mb-6 text-center">
              Give them an identity. They'll carry this name through the world.
            </p>

            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Enter a name..."
              maxLength={24}
              autoFocus
              className="w-full px-4 py-3 bg-gray-800/60 border border-gray-700/50 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
            />

            {error && (
              <p className="text-red-400 text-xs mt-2">{error}</p>
            )}

            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => { setStep('questions'); setQuestionIdx(SOUL_QUESTIONS.length - 1); }}
                className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
              >
                Back to questions
              </button>
              <button
                onClick={handleCreate}
                disabled={name.trim().length < 2}
                className={clsx(
                  'px-6 py-2.5 rounded-lg text-sm font-medium transition-all',
                  name.trim().length >= 2
                    ? 'bg-green-600 text-white hover:bg-green-500'
                    : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                )}
              >
                Bring to Life
              </button>
            </div>
          </div>
        )}

        {/* ── Creating ── */}
        {step === 'creating' && (
          <div className="p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
            <p className="text-gray-300 text-sm">Weaving soul into the world...</p>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && created && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-green-600/10 border border-green-500/20 flex items-center justify-center">
              <span className="text-3xl text-green-400">&#10003;</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">{created.name}</h2>
            <p className="text-blue-400 text-sm mb-1">{created.archetype}</p>
            <p className="text-gray-500 text-xs mb-6">
              Spawned at ({created.spawn_position.x}, {created.spawn_position.y})
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 transition-colors text-sm"
            >
              Watch Them Live
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
