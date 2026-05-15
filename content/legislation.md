# A Legislative Proposal for Algorithmic Congressional Redistricting

This document presents two instruments. The first is a federal statute that
Congress could enact today under its existing Article I, § 4 authority. The
second is a proposed constitutional amendment that would entrench the
underlying principle against future statutory reversal and extend it to
state legislative districts (which lie outside Congress's Elections Clause
reach).

The statute is the primary instrument. The amendment is offered as a
secondary recommendation for the entrenchment problem only.

---

## Part I: The Statute

### A Bill

To require the use of a publicly-specified, reproducible, non-partisan
algorithmic procedure for the drawing of congressional districts in every
State following each decennial census; to provide for judicial review of
districting plans for compliance with the procedure; and for other purposes.

*Be it enacted by the Senate and House of Representatives of the United
States of America in Congress assembled,*

---

### SECTION 1. SHORT TITLE; TABLE OF CONTENTS.

(a) **SHORT TITLE.** — This Act may be cited as the "Neutral Districting
Act of 2026."

(b) **TABLE OF CONTENTS.** —
- Sec. 1. Short title; table of contents.
- Sec. 2. Findings and purposes.
- Sec. 3. Definitions.
- Sec. 4. Mandatory algorithmic procedure for congressional districts.
- Sec. 5. The Independent Districting Standards Board; Algorithm Reference
  Specification.
- Sec. 6. Public reproducibility; ensemble publication; seed disclosure.
- Sec. 7. Judicial review; cause of action; remedies.
- Sec. 8. Effective date; transition; severability.

---

### SEC. 2. FINDINGS AND PURPOSES.

(a) **FINDINGS.** — The Congress finds the following:

(1) Article I, Section 2 of the Constitution, as construed in *Wesberry v.
Sanders*, 376 U.S. 1 (1964), requires that Representatives be apportioned
among congressional districts of substantially equal population.

(2) In *Rucho v. Common Cause*, 588 U.S. 684 (2019), the Supreme Court
held that partisan gerrymandering claims present nonjusticiable political
questions in federal court, leaving congressional districting subject only
to such limits as Congress affirmatively enacts under the Elections Clause
and as state courts may impose under state constitutions.

(3) Peer-reviewed research, including DeFord, Duchin, and Solomon,
"Recombination: A Family of Markov Chains for Redistricting," *Harvard
Data Science Review* 3(1) (2021), demonstrates that contemporary
algorithmic methods can sample the space of valid contiguous,
population-balanced districting plans in a publicly verifiable and
reproducible manner.

(4) Chen and Rodden, "Unintentional Gerrymandering: Political Geography
and Electoral Bias in Legislatures," *Quarterly Journal of Political
Science* 8(3) (2013), and subsequent literature, demonstrate that
neutrally-drawn districting plans do not, and cannot be expected to,
produce seat shares that exactly track popular-vote shares; the
geographic distribution of partisan voters in the contemporary United
States produces structural deviations from proportionality even under
plans drawn without any partisan input. The standard against which a
plan should be measured is therefore the distribution of plans produced
by neutral procedures, not proportional representation.

(5) Public confidence in the integrity of congressional elections is
served when districting plans are produced by a procedure whose inputs,
algorithm, randomness source, and outputs are simultaneously public,
reproducible by any third party, and free of discretionary partisan
input.

(b) **PURPOSES.** — The purposes of this Act are:

(1) to establish a uniform, reproducible procedure for the drawing of
congressional districts in every State, removing partisan discretion from
the line-drawing process;

(2) to require that the inputs, randomness, and outputs of every
congressional districting plan be made public in a form that permits any
member of the public to independently verify the plan's compliance with
this Act; and

(3) to provide an enforceable federal cause of action by which any
aggrieved voter may challenge a plan that fails to comply.

---

### SEC. 3. DEFINITIONS.

In this Act:

(1) **ALGORITHM.** — The term "algorithm" means a procedure consisting of
a Markov chain Monte Carlo sampler over the space of contiguous,
population-balanced graph partitions, conforming to the Algorithm
Reference Specification published under section 5.

(2) **ALGORITHM REFERENCE SPECIFICATION.** — The term "Algorithm
Reference Specification" means the technical specification published by
the Independent Districting Standards Board under section 5(c).

(3) **CONTIGUOUS.** — A district is "contiguous" when every census block
assigned to the district is reachable from every other census block in
the district by a path that traverses only census blocks assigned to the
same district and that crosses only census-block boundaries that lie
within the State.

(4) **DECENNIAL CYCLE.** — The term "decennial cycle" means the period
beginning on the date of release by the Census Bureau of the redistricting
data file under Public Law 94-171 for a decennial census and ending on
the corresponding date for the next decennial census.

(5) **DISTRICTING PLAN.** — The term "districting plan" means an
assignment, for each State, of every census block in the State to one of
the State's congressional districts.

(6) **ENSEMBLE.** — The term "ensemble" means a collection of districting
plans produced by repeated independent runs of the algorithm with
distinct random seeds.

(7) **POPULATION-BALANCED.** — A districting plan is "population-balanced"
when no district's population, as measured by the redistricting data file,
deviates from the State's average district population by more than one
percent.

(8) **REPRODUCIBLE.** — A districting plan is "reproducible" when, given
the plan's published inputs (geographic data, population data, random
seed, and Algorithm Reference Specification version), any third party can,
using only those inputs and freely available open-source software,
regenerate a bit-for-bit identical plan.

(9) **STATE.** — The term "State" includes each of the several States but
does not include any State entitled to only one Representative under the
apportionment then in effect.

---

### SEC. 4. MANDATORY ALGORITHMIC PROCEDURE FOR CONGRESSIONAL DISTRICTS.

(a) **GENERAL RULE.** — Notwithstanding any provision of State law to the
contrary, every State shall draw its congressional districts for each
decennial cycle by means of the procedure set forth in this section.

(b) **PROCEDURE.** —

(1) **STEP ONE: INPUTS.** — Not later than ninety days after the release
of the redistricting data file under Public Law 94-171, the State shall
publish:

(A) the official census-block geography file for the State, in the form
released by the Census Bureau;

(B) the official census-block population file under the redistricting data
file;

(C) the random seed selected under paragraph (2).

(2) **STEP TWO: SEED SELECTION.** — The random seed required by this
Act shall be a 256-bit integer derived as follows:

(A) Not earlier than thirty days nor later than fifteen days before the
publication required by paragraph (1), the chief election officer of the
State shall designate a date and time, falling not less than fifteen days
nor more than thirty days after such designation, at which the random
seed shall be generated.

(B) On the designated date and time, the chief election officer shall, in
the presence of representatives of each political party that received not
less than five percent of the popular vote in the State at the most
recent presidential election, generate the seed by computing the SHA-256
hash of the concatenation of:

(i) the closing prices, on the most recent business day prior to seed
generation, of the thirty stocks then comprising the Dow Jones Industrial
Average, in their order of listing on the New York Stock Exchange;

(ii) the winning numbers of every State lottery drawing held on that
business day, in chronological order; and

(iii) the headline of the most-recent print edition of The New York Times,
The Wall Street Journal, and the State's largest-circulation daily
newspaper, in that order.

(C) The chief election officer shall publish, contemporaneously with the
generation, both the inputs to the hash function and the resulting seed,
in a form that permits any member of the public to independently verify
the computation.

(3) **STEP THREE: ALGORITHM EXECUTION.** — The State shall execute the
Algorithm Reference Specification, with the inputs published under
paragraph (1) and the seed generated under paragraph (2), to produce a
districting plan for the State.

(4) **STEP FOUR: PLAN ENROLLMENT.** — The plan produced under paragraph
(3) shall, upon publication of its inputs and outputs in the form required
by section 7, become the official congressional districting plan of the
State for the decennial cycle.

(c) **NO DISCRETIONARY ADJUSTMENT.** — No person may modify, adjust, or
override the plan produced under subsection (b)(3). Any State law
purporting to authorize such modification, adjustment, or override is
preempted by this Act.

(d) **NO USE OF PARTISAN OR INCUMBENCY DATA.** — The Algorithm Reference
Specification shall not consume as input, and no implementation of the
algorithm shall consume as input, any of the following:

(1) the partisan registration of any voter;

(2) the residence of any incumbent or candidate;

(3) the historical vote shares of any precinct, county, or other
geographic unit; or

(4) any data field whose primary purpose is the prediction of partisan
electoral outcomes.

---

### SEC. 5. THE INDEPENDENT DISTRICTING STANDARDS BOARD.

(a) **ESTABLISHMENT.** — There is established within the Census Bureau,
but operating independently of any other component thereof, an
Independent Districting Standards Board (in this Act, the "Board").

(b) **COMPOSITION.** —

(1) **MEMBERSHIP.** — The Board shall consist of nine members, appointed
as follows:

(A) Three members shall be appointed by the President of the United
States, by and with the advice and consent of the Senate. Of these,
not more than two may be members of the same political party.

(B) Three members shall be appointed jointly by the Speaker of the House
of Representatives and the Minority Leader of the House of
Representatives. Of these, one shall be selected by the Speaker, one by
the Minority Leader, and the third by agreement of both, and not more
than two may be members of the same political party.

(C) Three members shall be appointed jointly by the Majority Leader of
the Senate and the Minority Leader of the Senate, on the same basis as
in subparagraph (B).

(2) **QUALIFICATIONS.** — Each member shall hold an earned doctorate or
its substantial equivalent in mathematics, statistics, computer science,
political science, geography, or a related field, and shall have a
demonstrated record of peer-reviewed publication in redistricting
methodology, computational geometry, or Markov chain theory.

(3) **TERMS.** — Members shall serve staggered six-year terms. No member
may serve more than two terms.

(c) **ALGORITHM REFERENCE SPECIFICATION.** —

(1) **PUBLICATION.** — Not later than two years before the release of
each decennial redistricting data file, the Board shall publish a complete
Algorithm Reference Specification.

(2) **CONTENTS.** — The Algorithm Reference Specification shall include:

(A) the precise mathematical definition of the Markov chain, including
the spanning-tree sampling procedure, the balance-cut criterion, and the
acceptance rule;

(B) the precise definition of the contiguity-graph construction from the
census-block geography;

(C) the precise definition of the population-balance tolerance, the
burn-in length, the polish phase (including any perturb-and-repolish
loop that resamples the chain to escape local minima), and the maximum
permissible number of independent re-runs from distinct derived seeds,
returning the lowest-deviation result;

(D) a graph-theoretic compactness criterion, expressed as a maximum
isoperimetric ratio (cross-cut edges divided by the smaller piece's node
count) for any accepted balanced cut, together with (i) a deterministic
schedule of threshold relaxation across multi-seed retries beginning at
a strict default and loosening monotonically only when no balanced cut
exists at the prior threshold, and (ii) a partition-level selection
rule under which, among multiple retries that all meet population
balance, the partition with the lowest mean cross-edge count per
district is chosen, preserving ergodicity of the Markov chain while
explicitly optimizing for compactness;

(E) a complete reference implementation in a publicly-readable
programming language, released under a permissive open-source license;

(F) a corpus of test inputs and expected outputs sufficient to verify
that any independent implementation produces bit-for-bit identical
results; and

(G) the deterministic pseudorandom number generator to be seeded by the
random seed under section 4(b)(2).

(3) **PEER REVIEW.** — Before publication under paragraph (1), the
Algorithm Reference Specification shall be subjected to public peer
review, with a comment period of not less than one hundred eighty days,
and the Board shall publish a written response to every substantive
comment received.

(4) **AMENDMENT.** — The Board may amend the Algorithm Reference
Specification between decennial cycles only by the same peer-review
procedure required under paragraph (3), and any such amendment shall
take effect only at the next decennial cycle following its publication.

(d) **PROHIBITION ON PARTISAN INPUT.** — In developing and amending the
Algorithm Reference Specification, the Board shall not consider the
predicted partisan effect of any methodological choice, and shall publish,
with each version of the Specification, a written certification by every
member that no such consideration was made.

---

### SEC. 6. PUBLIC REPRODUCIBILITY; ENSEMBLE PUBLICATION; SEED DISCLOSURE.

(a) **REQUIRED PUBLICATIONS.** — Within fifteen days after the production
of a plan under section 4, the State shall publish, in a single open-data
repository hosted by the Census Bureau:

(1) every input file consumed by the algorithm;

(2) the random seed and its full derivation under section 4(b)(2);

(3) the version of the Algorithm Reference Specification used;

(4) the complete output of the algorithm, including the final districting
plan and every intermediate state of the Markov chain, in a format
sufficient to permit bit-for-bit reproduction; and

(5) a SHA-256 hash chain over all of the above, to permit detection of
post-publication modification.

(b) **CITIZEN VERIFICATION.** — The Census Bureau shall maintain a public
verification service that, given any State's published artifacts under
subsection (a), independently re-executes the Algorithm Reference
Specification and certifies whether the published plan matches the
re-computed plan.

(c) **PROHIBITION ON SUPPRESSION.** — No State, and no officer of any
State, shall withhold, redact, or delay the publication required by
subsection (a). Any failure to comply shall constitute a violation of
this Act.

---

### SEC. 7. JUDICIAL REVIEW; CAUSE OF ACTION; REMEDIES.

(a) **CAUSE OF ACTION.** — Any individual registered to vote in any
State whose congressional districting plan was produced under this Act
may bring a civil action in the United States district court for the
district in which the individual resides to enforce this Act.

(b) **GROUNDS.** — A plan may be challenged on any of the following
grounds:

(1) The plan was not produced by execution of the Algorithm Reference
Specification with the published seed.

(2) The seed was generated other than as required by section 4(b)(2).

(3) The State failed to publish the materials required by section 6.

(4) The plan was modified, adjusted, or overridden in violation of
section 4(c).

(c) **STANDARD OF REVIEW.** — In an action brought under this section,
the burden is on the State to establish, by a preponderance of the
evidence, that the published plan is the bit-for-bit output of executing
the published Algorithm Reference Specification with the published seed
on the published inputs. A challenger who presents an independent
re-execution producing a non-matching output shall be entitled to
judgment as a matter of law unless the State produces such a re-execution
of its own.

(d) **REMEDIES.** —

(1) **DEFAULT.** — Upon a finding of violation, the court shall enter an
order directing the State to re-execute the Algorithm Reference
Specification on the published inputs with the published seed, and shall
enter the resulting plan as the State's congressional districting plan
for the decennial cycle.

(2) **REPLACEMENT SEED.** — Where the violation consists of the seed
itself having been improperly generated, the court shall order the
generation of a replacement seed under section 4(b)(2), with the
designated date set by the court, and direct re-execution accordingly.

(e) **JUDICIAL ECONOMY.** — Actions under this section shall proceed in
the form of an action for declaratory relief and shall be heard by a
three-judge district court convened under section 2284 of title 28,
United States Code, with direct appeal to the Supreme Court.

---

### SEC. 8. EFFECTIVE DATE; TRANSITION; SEVERABILITY.

(a) **EFFECTIVE DATE.** — This Act shall take effect upon enactment, and
shall first apply to the decennial cycle following the 2030 census.

(b) **TRANSITION.** — Until the cycle described in subsection (a), the
districting plans in effect on the date of enactment shall continue in
effect, except that any State whose plan is invalidated under State or
Federal law during the interim period shall produce its replacement plan
by the procedure of this Act.

(c) **NO RETROACTIVE EFFECT.** — Nothing in this Act creates any cause of
action with respect to any election held before the effective date in
subsection (a).

(d) **SEVERABILITY.** — If any provision of this Act, or the application
of any provision to any person or circumstance, is held to be
unconstitutional or otherwise invalid, the remaining provisions and
applications shall not be affected.

---

## Part II: A Proposed Constitutional Amendment

### Statement of Need

The statute in Part I is enforceable today under Congress's existing
Article I, § 4 authority over the manner of holding congressional
elections. It does not, however, reach state legislative districts, which
are governed by state constitutions and lie outside Congress's reach
under the Elections Clause. It is also subject to repeal or modification
by any future Congress.

If the goal is to constitutionalize the principle and to extend it to all
legislative districting in the United States — federal, state, and local —
a constitutional amendment is required.

The proposed amendment is brief, by design. It establishes the principle
in a form that admits of legislative implementation without freezing the
specific algorithmic details of any particular era's mathematics into the
constitutional text.

### Article XXVIII (Proposed)

**SECTION 1.** Every legislative district for the election of any member
of the House of Representatives, of any State legislature, or of any
local legislative body, shall be drawn by a procedure that:

(1) is publicly specified in advance of its application;

(2) is reproducible by any third party from publicly-disclosed inputs and
randomness; and

(3) does not consume as input, and does not condition its output on, the
partisan registration of any voter, the residence of any incumbent or
candidate, or the predicted partisan effect of any line placement.

**SECTION 2.** The Congress shall have power to enforce this article by
appropriate legislation, and shall publish, in advance of each decennial
cycle, the procedure required by section 1 for districts within its
Article I, § 4 authority.

**SECTION 3.** Each State shall publish, in advance of each decennial
cycle, the procedure required by section 1 for districts within its
authority.

**SECTION 4.** The judicial power of the United States shall extend to
controversies arising under this article. The first sentence of clause 1
of section 2 of Article III, and the second clause of the Eleventh
Amendment, shall not be construed to bar any such controversy.

---

## Drafter's Note on Design Choices

A few choices in the foregoing warrant a brief explanation.

**Why a Markov chain procedure rather than an optimization procedure.**
The statute deliberately requires a stochastic sampling procedure (ReCom)
rather than a deterministic optimization (e.g., minimize total perimeter).
A deterministic optimum is a single map; a stochastic sample is a
distribution. The latter makes it possible for any future analyst to
characterize the *space* of valid plans, not merely to verify that one
plan was produced correctly. This matters for evaluating whether any
particular feature of a plan (e.g., its racial composition, or its
partisan tilt under a given electorate) is a typical feature of neutral
maps or an outlier. *See* DeFord, Duchin, and Solomon, *supra*, on the
mixing properties and applied verification advantages of ReCom.

**Why no compactness or political-subdivision criterion.**
The statute imposes only contiguity and population balance. It does not
require compactness, county-line preservation,
"communities of interest" preservation, or any other shape-based
criterion. This is by design. Every additional criterion is a vector for
discretionary application, which is the entrenchment vector for
gerrymandering. A shape-blind procedure produces shapes that look
reasonable in expectation (because the Markov chain naturally produces
shapes with low perimeter as a byproduct of how spanning-tree cuts work),
without requiring any drafter, board member, or judge to weigh competing
shape criteria. This is the principal lesson of the post-*Rucho* state
litigation: criteria that require human judgment are criteria that admit
human bias.

**Why the seed protocol.**
A reproducible procedure requires a published seed; a seed that is
chosen by a partisan actor permits cherry-picking among many possible
maps until a partisan-favorable one appears. The protocol in section
4(b)(2) is designed to make seed cherry-picking infeasible: the seed is
generated from inputs (stock prices, lottery numbers, newspaper
headlines) that no actor controls in advance, and is published
contemporaneously with its inputs so that any modification of the inputs
after the fact is detectable.

**Why the Independent Districting Standards Board houses the algorithm,
not Congress.**
The mathematics of Markov chain redistricting will improve over the
coming decades. Freezing one specific procedure into the United States
Code would lock the Nation into 2026's state of the art. The Board, with
its peer-reviewed amendment procedure, allows the algorithm to evolve
while preserving the political-neutrality and reproducibility properties
that this Act requires. The Board's structure mirrors that of the Federal
Election Commission and the Federal Reserve Board of Governors in its
balanced-appointment structure, and that of the National Institute of
Standards and Technology in its substantive-expertise requirement.

**Why bit-for-bit reproducibility.**
The statute requires bit-for-bit reproduction (section 3(8); section
8(c)). This is stronger than "approximately reproduces" or "produces a
plan with the same statistical properties." The reason is enforcement:
any deviation from bit-for-bit identity is detectable by a citizen with
a laptop, and the cause-of-action structure in section 8 makes such
deviations grounds for invalidation. Weaker reproducibility standards
would shift the enforcement burden from arithmetic verification to
expert-witness statistical contestation, which is precisely the
discretionary vector this Act seeks to eliminate.

**Why the dashboard's NC outcome (~5 D / 9 R on a 48 D / 52 R popular
vote) is the right benchmark, not proportional representation.**
The Findings in section 2(a)(5) acknowledge explicitly that
algorithmically-neutral plans do not produce proportional seat shares.
This is essential. A statute requiring proportional outcomes would
require *building in* a partisan correction to counteract the structural
bias that geography produces — which is itself a form of gerrymandering,
just one in the opposite direction. The honest standard is: a plan should
look like a typical plan from the neutral-procedure distribution. Plans
that lie far in the tail of that distribution are suspect; plans that lie
near the median are not. NC's expected ~5 D / ~9 R seat split under
neutral procedures is the median of the procedure's distribution given
NC's geography, not a defect of either the procedure or the State. A
2-1 Republican advantage in seats arising from the geographic
distribution of partisans is a fact about North Carolina; reproducing it
in a neutral plan is a feature, not a bug, of the procedure. *See*
Goedert, "Gerrymandering or Geography? How Democrats Won the Popular
Vote but Lost the Congress in 2012," *Research and Politics* 1(1) (2014).
